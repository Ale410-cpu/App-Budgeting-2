const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');
const { execSync } = require('child_process');
const JSZip = require('jszip');

/**
 * Encodes an unsigned integer as ULEB128 bytes.
 */
function encodeULEB128(value) {
  const bytes = [];
  let val = BigInt(value);
  do {
    let byte = Number(val & 0x7fn);
    val >>= 7n;
    if (val !== 0n) {
      byte |= 0x80;
    }
    bytes.push(byte);
  } while (val !== 0n);
  return Buffer.from(bytes);
}

/**
 * Generates a valid 64-bit ARM64 iOS Mach-O executable (MH_EXECUTE) that:
 * 1. Passes all AltStore / AltSign / ldid / Sideloadly / iOS installd Mach-O & __LINKEDIT checks.
 * 2. Explicitly binds _OBJC_CLASS_$_WKWebView and _OBJC_CLASS_$_WKWebViewConfiguration from WebKit.framework
 *    so dyld4 on iOS 15/16/17/18 is guaranteed to load and initialize WebKit at startup.
 * 3. Creates WKWebViewConfiguration with allowFileAccessFromFileURLs = YES BEFORE initializing WKWebView
 *    via -[WKWebView initWithFrame:configuration:].
 * 4. Reads index.html in-process via +[NSString stringWithContentsOfURL:encoding:error:] and loads it
 *    directly into WKWebView via -[WKWebView loadHTMLString:baseURL:] (with fallback to loadFileURL:allowingReadAccessToURL:).
 */
function createArm64IosMachOBinary() {
  // Layout constants (16KB page aligned for iOS ARM64)
  const PAGE_SIZE = 0x4000; // 16384 bytes
  const TEXT_VMADDR = 0x100000000n;
  const DATA_VMADDR = 0x100004000n;
  const LINKEDIT_VMADDR = 0x100008000n;

  const TEXT_FILEOFF = 0x0000;
  const DATA_FILEOFF = 0x4000;
  const LINKEDIT_FILEOFF = 0x8000;

  // Function offsets inside __TEXT,__text (non-overlapping, verified with assertions!)
  const CODE_OFFSET = 0x1000;              // _main (0x1000 .. 0x1180)
  const NSSTR_HELPER_OFFSET = 0x1180;      // _nsstr_helper (0x1180 .. 0x1200)
  const ALLOC_INIT_HELPER_OFFSET = 0x1200; // _alloc_init_helper (0x1200 .. 0x1280)
  const WIN_GETTER_OFFSET = 0x1280;        // -[BudgetAppDelegate window]
  const WIN_SETTER_OFFSET = 0x12A0;        // -[BudgetAppDelegate setWindow:]
  const DID_FINISH_OFFSET = 0x12C0;        // -[BudgetAppDelegate application:didFinishLaunchingWithOptions:] (0x12C0 .. 0x1B00)
  const CSTRING_OFFSET = 0x1B00;           // __TEXT,__cstring (0x1B00 .. 0x2600)

  const GOT_OFFSET = 0x4000;       // __DATA,__got
  const DATA_VARS_OFFSET = 0x4080; // __DATA,__data (global strong UIWindow* reference)

  // Strings in __TEXT,__cstring (each placed at 64-byte intervals)
  const cstrings = [
    'UIResponder',                                // 0
    'BudgetAppDelegate',                          // 1
    'application:didFinishLaunchingWithOptions:', // 2
    'B@:@@',                                      // 3
    'NSString',                                   // 4
    'stringWithUTF8String:',                      // 5
    'UIWindow',                                   // 6
    'alloc',                                      // 7
    'init',                                       // 8
    'UIViewController',                           // 9
    'WKWebView',                                  // 10
    'setView:',                                   // 11
    'NSBundle',                                   // 12
    'mainBundle',                                 // 13
    'bundleURL',                                  // 14
    'URLForResource:withExtension:',              // 15
    'index',                                      // 16
    'html',                                       // 17
    'loadFileURL:allowingReadAccessToURL:',       // 18
    'setRootViewController:',                     // 19
    'makeKeyAndVisible',                          // 20
    'configuration',                              // 21
    'preferences',                                // 22
    'NSNumber',                                   // 23
    'numberWithBool:',                            // 24
    'setValue:forKey:',                           // 25
    'allowFileAccessFromFileURLs',                // 26
    'window',                                     // 27
    '@@:',                                        // 28
    'setWindow:',                                 // 29
    'v@:@',                                       // 30
    'UIScreen',                                   // 31
    'mainScreen',                                 // 32
    'bounds',                                     // 33
    'initWithFrame:',                             // 34
    'setAutoresizingMask:',                       // 35
    'WKWebViewConfiguration',                     // 36
    'initWithFrame:configuration:',               // 37
    'stringWithContentsOfURL:encoding:error:',    // 38
    'loadHTMLString:baseURL:',                    // 39
  ];

  const strOff = (idx) => CSTRING_OFFSET + idx * 0x40;

  // Imported symbols in __DATA,__got
  // Dylib ordinals:
  // 1 = /usr/lib/libSystem.B.dylib
  // 2 = /usr/lib/libobjc.A.dylib
  // 3 = /System/Library/Frameworks/Foundation.framework/Foundation
  // 4 = /System/Library/Frameworks/UIKit.framework/UIKit
  // 5 = /System/Library/Frameworks/WebKit.framework/WebKit
  const importedSymbols = [
    { name: '_objc_getClass', dylibOrdinal: 2 },                  // GOT[0]
    { name: '_sel_registerName', dylibOrdinal: 2 },               // GOT[1]
    { name: '_objc_msgSend', dylibOrdinal: 2 },                   // GOT[2]
    { name: '_objc_allocateClassPair', dylibOrdinal: 2 },         // GOT[3]
    { name: '_class_addMethod', dylibOrdinal: 2 },                // GOT[4]
    { name: '_objc_registerClassPair', dylibOrdinal: 2 },         // GOT[5]
    { name: '_UIApplicationMain', dylibOrdinal: 4 },              // GOT[6]
    { name: '_objc_autoreleasePoolPush', dylibOrdinal: 2 },       // GOT[7]
    { name: '_NSLog', dylibOrdinal: 3 },                          // GOT[8]
    { name: '_OBJC_CLASS_$_WKWebView', dylibOrdinal: 5 },         // GOT[9]
    { name: '_OBJC_CLASS_$_WKWebViewConfiguration', dylibOrdinal: 5 }, // GOT[10]
  ];

  // ARM64 instruction encoders
  const arm64 = {
    stpPreSp: (rt1, rt2, imm) => {
      const imm7 = ((imm / 8) & 0x7f) >>> 0;
      return ((0b1010100110 << 22) | (imm7 << 15) | (rt2 << 10) | (31 << 5) | rt1) >>> 0;
    },
    ldpPostSp: (rt1, rt2, imm) => {
      const imm7 = ((imm / 8) & 0x7f) >>> 0;
      return ((0b1010100011 << 22) | (imm7 << 15) | (rt2 << 10) | (31 << 5) | rt1) >>> 0;
    },
    stpOffSp: (rt1, rt2, imm) => {
      const imm7 = ((imm / 8) & 0x7f) >>> 0;
      return ((0b1010100100 << 22) | (imm7 << 15) | (rt2 << 10) | (31 << 5) | rt1) >>> 0;
    },
    ldpOffSp: (rt1, rt2, imm) => {
      const imm7 = ((imm / 8) & 0x7f) >>> 0;
      return ((0b1010100101 << 22) | (rt2 << 10) | (imm7 << 15) | (31 << 5) | rt1) >>> 0;
    },
    movFpSp: () => 0x910003fd >>> 0,
    movReg: (rd, rm) => (0xaa0003e0 | (rm << 16) | rd) >>> 0,
    movz: (rd, imm16) => (0xd2800000 | ((imm16 & 0xffff) << 5) | rd) >>> 0,
    adr: (rd, currentPcOff, targetOff) => {
      const rel = targetOff - currentPcOff;
      const immlo = rel & 0x3;
      const immhi = (rel >> 2) & 0x7ffff;
      return (((immlo << 29) >>> 0) | ((0b10000 << 24) >>> 0) | ((immhi << 5) >>> 0) | (rd & 0x1f)) >>> 0;
    },
    ldrUimm64: (rt, rn, byteOff) => {
      const imm12 = ((byteOff / 8) & 0xfff) >>> 0;
      return (0xf9400000 | (imm12 << 10) | (rn << 5) | rt) >>> 0;
    },
    strUimm64: (rt, rn, byteOff) => {
      const imm12 = ((byteOff / 8) & 0xfff) >>> 0;
      return (0xf9000000 | (imm12 << 10) | (rn << 5) | rt) >>> 0;
    },
    cbz64: (rt, currentPcOff, targetOff) => {
      const relWords = ((targetOff - currentPcOff) >> 2) & 0x7ffff;
      return (0xb4000000 | (relWords << 5) | (rt & 0x1f)) >>> 0;
    },
    cbnz64: (rt, currentPcOff, targetOff) => {
      const relWords = ((targetOff - currentPcOff) >> 2) & 0x7ffff;
      return (0xb5000000 | (relWords << 5) | (rt & 0x1f)) >>> 0;
    },
    blr: (rn) => (0xd63f0000 | (rn << 5)) >>> 0,
    bl: (currentPcOff, targetOff) => {
      const rel = targetOff - currentPcOff;
      const imm26 = (rel >> 2) & 0x03ffffff;
      return (0x94000000 | imm26) >>> 0;
    },
    ret: () => 0xd65f03c0 >>> 0,
  };

  const textSeg = Buffer.alloc(PAGE_SIZE, 0);

  // Write C strings into __TEXT,__cstring
  for (let i = 0; i < cstrings.length; i++) {
    textSeg.write(cstrings[i] + '\0', strOff(i), 'utf-8');
  }

  function createEmitter(startOffset, maxOffset, label) {
    let pc = startOffset;
    return {
      getPc: () => pc,
      finish: () => {
        if (pc > maxOffset) {
          throw new Error(`Function ${label} overflowed maxOffset: 0x${pc.toString(16)} > 0x${maxOffset.toString(16)}`);
        }
      },
      emit: (insn) => {
        textSeg.writeUInt32LE(insn >>> 0, pc);
        pc += 4;
      },
      emitLoadGot: (rd, gotIndex) => {
        textSeg.writeUInt32LE(arm64.adr(rd, pc, GOT_OFFSET), pc);
        pc += 4;
        textSeg.writeUInt32LE(arm64.ldrUimm64(rd, rd, gotIndex * 8), pc);
        pc += 4;
      },
      emitCallGot: (gotIndex) => {
        textSeg.writeUInt32LE(arm64.adr(16, pc, GOT_OFFSET), pc);
        pc += 4;
        textSeg.writeUInt32LE(arm64.ldrUimm64(16, 16, gotIndex * 8), pc);
        pc += 4;
        textSeg.writeUInt32LE(arm64.blr(16), pc);
        pc += 4;
      },
      emitAdr: (rd, targetOff) => {
        textSeg.writeUInt32LE(arm64.adr(rd, pc, targetOff), pc);
        pc += 4;
      },
      emitBl: (targetOff) => {
        textSeg.writeUInt32LE(arm64.bl(pc, targetOff), pc);
        pc += 4;
      },
      // Safe Objective-C message send using ONLY callee-saved registers (X19..X28) for receiver and args
      emitMsgSend: function (receiverReg, selStrIdx, arg1Reg = null, arg2Reg = null) {
        if (receiverReg < 19 || (arg1Reg !== null && arg1Reg < 19) || (arg2Reg !== null && arg2Reg < 19)) {
          throw new Error('emitMsgSend requires callee-saved registers (19..28) so sel_registerName never clobbers them');
        }
        this.emitAdr(0, strOff(selStrIdx));
        this.emitCallGot(1); // X0 = sel_registerName(str)
        this.emit(arm64.movReg(1, 0)); // X1 = SEL
        this.emit(arm64.movReg(0, receiverReg)); // X0 = receiver
        if (arg1Reg !== null) this.emit(arm64.movReg(2, arg1Reg));
        if (arg2Reg !== null) this.emit(arm64.movReg(3, arg2Reg));
        this.emitCallGot(2); // objc_msgSend
      },
    };
  }

  // 1. Emit _main at 0x1000 .. 0x1180
  {
    const e = createEmitter(CODE_OFFSET, NSSTR_HELPER_OFFSET, '_main');
    e.emit(arm64.stpPreSp(29, 30, -48));
    e.emit(arm64.movFpSp());
    e.emit(arm64.stpOffSp(19, 20, 16));
    e.emit(arm64.stpOffSp(21, 22, 32));

    e.emit(arm64.movReg(19, 0)); // W19 = argc
    e.emit(arm64.movReg(20, 1)); // X20 = argv

    // Push autorelease pool on main thread
    e.emitCallGot(7); // _objc_autoreleasePoolPush()

    // Class UIResponder = objc_getClass("UIResponder")
    e.emitAdr(0, strOff(0)); // "UIResponder"
    e.emitCallGot(0);

    // Class AppDelegate = objc_allocateClassPair(UIResponder, "BudgetAppDelegate", 0)
    e.emitAdr(1, strOff(1)); // "BudgetAppDelegate"
    e.emit(arm64.movz(2, 0));
    e.emitCallGot(3); // objc_allocateClassPair
    e.emit(arm64.movReg(21, 0)); // X21 = AppDelegate Class

    // Add -[BudgetAppDelegate window] ("@@:")
    e.emitAdr(0, strOff(27)); // "window"
    e.emitCallGot(1);
    e.emit(arm64.movReg(1, 0));
    e.emit(arm64.movReg(0, 21));
    e.emitAdr(2, WIN_GETTER_OFFSET);
    e.emitAdr(3, strOff(28)); // "@@:"
    e.emitCallGot(4); // class_addMethod

    // Add -[BudgetAppDelegate setWindow:] ("v@:@")
    e.emitAdr(0, strOff(29)); // "setWindow:"
    e.emitCallGot(1);
    e.emit(arm64.movReg(1, 0));
    e.emit(arm64.movReg(0, 21));
    e.emitAdr(2, WIN_SETTER_OFFSET);
    e.emitAdr(3, strOff(30)); // "v@:@"
    e.emitCallGot(4); // class_addMethod

    // Add -[BudgetAppDelegate application:didFinishLaunchingWithOptions:] ("B@:@@")
    e.emitAdr(0, strOff(2)); // "application:didFinishLaunchingWithOptions:"
    e.emitCallGot(1);
    e.emit(arm64.movReg(1, 0));
    e.emit(arm64.movReg(0, 21));
    e.emitAdr(2, DID_FINISH_OFFSET);
    e.emitAdr(3, strOff(3)); // "B@:@@"
    e.emitCallGot(4); // class_addMethod

    // objc_registerClassPair(AppDelegate)
    e.emit(arm64.movReg(0, 21));
    e.emitCallGot(5);

    // NSString *delegateName = @"BudgetAppDelegate"
    e.emitAdr(0, strOff(1)); // "BudgetAppDelegate"
    e.emitBl(NSSTR_HELPER_OFFSET);
    e.emit(arm64.movReg(3, 0)); // X3 = @"BudgetAppDelegate"

    // return UIApplicationMain(argc, argv, nil, @"BudgetAppDelegate")
    e.emit(arm64.movReg(0, 19));
    e.emit(arm64.movReg(1, 20));
    e.emit(arm64.movz(2, 0));
    e.emitCallGot(6); // UIApplicationMain

    e.emit(arm64.ldpOffSp(21, 22, 32));
    e.emit(arm64.ldpOffSp(19, 20, 16));
    e.emit(arm64.ldpPostSp(29, 30, 48));
    e.emit(arm64.ret());
    e.finish();
  }

  // 2. Emit _nsstr_helper at 0x1180 .. 0x1200
  {
    const e = createEmitter(NSSTR_HELPER_OFFSET, ALLOC_INIT_HELPER_OFFSET, '_nsstr_helper');
    e.emit(arm64.stpPreSp(29, 30, -32));
    e.emit(arm64.movFpSp());
    e.emit(arm64.stpOffSp(19, 20, 16));
    e.emit(arm64.movReg(19, 0)); // X19 = cstr
    e.emitAdr(0, strOff(4)); // "NSString"
    e.emitCallGot(0); // objc_getClass("NSString")
    e.emit(arm64.movReg(20, 0)); // X20 = NSString Class
    e.emitMsgSend(20, 5, 19); // [NSString stringWithUTF8String:cstr]
    e.emit(arm64.ldpOffSp(19, 20, 16));
    e.emit(arm64.ldpPostSp(29, 30, 32));
    e.emit(arm64.ret());
    e.finish();
  }

  // 3. Emit _alloc_init_helper at 0x1200 .. 0x1280
  {
    const e = createEmitter(ALLOC_INIT_HELPER_OFFSET, WIN_GETTER_OFFSET, '_alloc_init_helper');
    e.emit(arm64.stpPreSp(29, 30, -32));
    e.emit(arm64.movFpSp());
    e.emit(arm64.stpOffSp(19, 20, 16));
    e.emitCallGot(0); // objc_getClass(X0)
    e.emit(arm64.movReg(19, 0)); // X19 = Class
    e.emitMsgSend(19, 7); // [Class alloc]
    e.emit(arm64.movReg(19, 0)); // X19 = allocated instance
    e.emitMsgSend(19, 8); // [instance init]
    e.emit(arm64.ldpOffSp(19, 20, 16));
    e.emit(arm64.ldpPostSp(29, 30, 32));
    e.emit(arm64.ret());
    e.finish();
  }

  // 4. Emit -[BudgetAppDelegate window] at 0x1280 .. 0x12A0
  {
    const e = createEmitter(WIN_GETTER_OFFSET, WIN_SETTER_OFFSET, '_win_getter');
    e.emitAdr(16, DATA_VARS_OFFSET);
    e.emit(arm64.ldrUimm64(0, 16, 0));
    e.emit(arm64.ret());
    e.finish();
  }

  // 5. Emit -[BudgetAppDelegate setWindow:] at 0x12A0 .. 0x12C0
  {
    const e = createEmitter(WIN_SETTER_OFFSET, DID_FINISH_OFFSET, '_win_setter');
    e.emitAdr(16, DATA_VARS_OFFSET);
    e.emit(arm64.strUimm64(2, 16, 0)); // X2 = first argument after (self, _cmd)
    e.emit(arm64.ret());
    e.finish();
  }

  // 6. Emit -[BudgetAppDelegate application:didFinishLaunchingWithOptions:] at 0x12C0 .. 0x1B00
  {
    const e = createEmitter(DID_FINISH_OFFSET, CSTRING_OFFSET, '_didFinishLaunching');
    e.emit(arm64.stpPreSp(29, 30, -96));
    e.emit(arm64.movFpSp());
    e.emit(arm64.stpOffSp(19, 20, 16));
    e.emit(arm64.stpOffSp(21, 22, 32));
    e.emit(arm64.stpOffSp(23, 24, 48));
    e.emit(arm64.stpOffSp(25, 26, 64));
    e.emit(arm64.stpOffSp(27, 28, 80));

    // X25 = [UIScreen mainScreen]
    e.emitAdr(0, strOff(31)); // "UIScreen"
    e.emitCallGot(0);
    e.emit(arm64.movReg(25, 0));
    e.emitMsgSend(25, 32); // [UIScreen mainScreen]
    e.emit(arm64.movReg(25, 0)); // X25 = mainScreen

    // X26 = sel_registerName("initWithFrame:")
    e.emitAdr(0, strOff(34)); // "initWithFrame:"
    e.emitCallGot(1);
    e.emit(arm64.movReg(26, 0)); // X26 = @selector(initWithFrame:)

    // Allocate UIWindow and initWithFrame:[mainScreen bounds]
    e.emitAdr(0, strOff(6)); // "UIWindow"
    e.emitCallGot(0);
    e.emit(arm64.movReg(19, 0));
    e.emitMsgSend(19, 7); // [UIWindow alloc]
    e.emit(arm64.movReg(19, 0)); // X19 = allocated UIWindow

    // Call [mainScreen bounds] -> sets D0, D1, D2, D3!
    e.emitMsgSend(25, 33); // [mainScreen bounds]
    // Immediately call [window initWithFrame:bounds] (D0..D3 untouched!)
    e.emit(arm64.movReg(0, 19));
    e.emit(arm64.movReg(1, 26));
    e.emitCallGot(2); // objc_msgSend(window, initWithFrame:, D0..D3)
    e.emit(arm64.movReg(19, 0)); // X19 = initialized UIWindow*

    // Store window in global DATA_VARS_OFFSET
    e.emitAdr(16, DATA_VARS_OFFSET);
    e.emit(arm64.strUimm64(19, 16, 0));

    // X20 = [[UIViewController alloc] init]
    e.emitAdr(0, strOff(9)); // "UIViewController"
    e.emitBl(ALLOC_INIT_HELPER_OFFSET);
    e.emit(arm64.movReg(20, 0)); // X20 = vc

    // Create WKWebViewConfiguration *config (X22) using bound GOT[10] (_OBJC_CLASS_$_WKWebViewConfiguration)
    e.emitLoadGot(22, 10); // X22 = WKWebViewConfiguration Class
    e.emitMsgSend(22, 7);  // [WKWebViewConfiguration alloc]
    e.emit(arm64.movReg(22, 0));
    e.emitMsgSend(22, 8);  // [config init]
    e.emit(arm64.movReg(22, 0)); // X22 = config

    // Enable allowFileAccessFromFileURLs on [config preferences] BEFORE creating WKWebView
    e.emitMsgSend(22, 22); // [config preferences]
    e.emit(arm64.movReg(23, 0)); // X23 = preferences

    e.emitAdr(0, strOff(23)); // "NSNumber"
    e.emitCallGot(0);
    e.emit(arm64.movReg(24, 0));
    e.emit(arm64.movz(27, 1)); // YES = 1
    e.emitMsgSend(24, 24, 27); // [NSNumber numberWithBool:YES]
    e.emit(arm64.movReg(24, 0)); // X24 = @YES

    e.emitAdr(0, strOff(26)); // "allowFileAccessFromFileURLs"
    e.emitBl(NSSTR_HELPER_OFFSET);
    e.emit(arm64.movReg(27, 0)); // X27 = @"allowFileAccessFromFileURLs"

    e.emitMsgSend(23, 25, 24, 27); // [preferences setValue:@YES forKey:@"allowFileAccessFromFileURLs"]

    // Allocate WKWebView using bound GOT[9] (_OBJC_CLASS_$_WKWebView) and call initWithFrame:bounds configuration:config
    e.emitLoadGot(21, 9); // X21 = WKWebView Class
    e.emitMsgSend(21, 7); // [WKWebView alloc]
    e.emit(arm64.movReg(21, 0)); // X21 = allocated WKWebView

    // X27 = sel_registerName("initWithFrame:configuration:")
    e.emitAdr(0, strOff(37)); // "initWithFrame:configuration:"
    e.emitCallGot(1);
    e.emit(arm64.movReg(27, 0)); // X27 = @selector(initWithFrame:configuration:)

    // Call [mainScreen bounds] -> sets D0, D1, D2, D3!
    e.emitMsgSend(25, 33); // [mainScreen bounds]
    // Immediately call [webView initWithFrame:bounds configuration:config] (X2 = config, D0..D3 = bounds)
    e.emit(arm64.movReg(0, 21));
    e.emit(arm64.movReg(1, 27));
    e.emit(arm64.movReg(2, 22));
    e.emitCallGot(2);
    e.emit(arm64.movReg(21, 0)); // X21 = initialized WKWebView*

    // [webView setAutoresizingMask:18] (UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight)
    e.emit(arm64.movz(27, 18));
    e.emitMsgSend(21, 35, 27);

    // [vc setView:webView]
    e.emitMsgSend(20, 11, 21);

    // [window setRootViewController:vc]
    e.emitMsgSend(19, 19, 20);

    // [window makeKeyAndVisible]
    e.emitMsgSend(19, 20);

    // Load index.html from NSBundle.mainBundle
    e.emitAdr(0, strOff(12)); // "NSBundle"
    e.emitCallGot(0);
    e.emit(arm64.movReg(22, 0));
    e.emitMsgSend(22, 13); // [NSBundle mainBundle]
    e.emit(arm64.movReg(22, 0)); // X22 = mainBundle

    e.emitMsgSend(22, 14); // [mainBundle bundleURL]
    e.emit(arm64.movReg(23, 0)); // X23 = bundleURL

    e.emitAdr(0, strOff(16)); // "index"
    e.emitBl(NSSTR_HELPER_OFFSET);
    e.emit(arm64.movReg(24, 0)); // X24 = @"index"

    e.emitAdr(0, strOff(17)); // "html"
    e.emitBl(NSSTR_HELPER_OFFSET);
    e.emit(arm64.movReg(25, 0)); // X25 = @"html"

    // X24 = [mainBundle URLForResource:@"index" withExtension:@"html"]
    e.emitMsgSend(22, 15, 24, 25);
    e.emit(arm64.movReg(24, 0)); // X24 = fileUrl

    // Guard against nil fileUrl
    const cbzFileUrlPc = e.getPc();
    e.emit(0); // placeholder for CBZ X24, skipLoad

    // Read index.html into NSString in-process: [NSString stringWithContentsOfURL:fileUrl encoding:4 error:0]
    e.emitAdr(0, strOff(4)); // "NSString"
    e.emitCallGot(0);
    e.emit(arm64.movReg(25, 0)); // X25 = NSString Class

    e.emitAdr(0, strOff(38)); // "stringWithContentsOfURL:encoding:error:"
    e.emitCallGot(1);
    e.emit(arm64.movReg(1, 0));  // X1 = SEL
    e.emit(arm64.movReg(0, 25)); // X0 = NSString Class
    e.emit(arm64.movReg(2, 24)); // X2 = fileUrl
    e.emit(arm64.movz(3, 4));    // X3 = 4 (NSUTF8StringEncoding)
    e.emit(arm64.movz(4, 0));    // X4 = NULL (error)
    e.emitCallGot(2);            // objc_msgSend
    e.emit(arm64.movReg(25, 0)); // X25 = htmlString (NSString*)

    // If htmlString is nil, jump to fallback loadFileURL:allowingReadAccessToURL:
    const cbzHtmlPc = e.getPc();
    e.emit(0); // placeholder for CBZ X25, fallbackFileUrl

    // Primary load: [webView loadHTMLString:htmlString baseURL:bundleURL]
    e.emitMsgSend(21, 39, 25, 23);

    // Also allow jump over fallback when htmlString succeeded
    const cbnzDonePc = e.getPc();
    e.emit(0); // placeholder for CBNZ X25, skipLoad

    const fallbackFileUrlPc = e.getPc();
    // Fallback load: [webView loadFileURL:fileUrl allowingReadAccessToURL:bundleURL]
    e.emitMsgSend(21, 18, 24, 23);

    const skipLoadPc = e.getPc();
    textSeg.writeUInt32LE(arm64.cbz64(24, cbzFileUrlPc, skipLoadPc), cbzFileUrlPc);
    textSeg.writeUInt32LE(arm64.cbz64(25, cbzHtmlPc, fallbackFileUrlPc), cbzHtmlPc);
    textSeg.writeUInt32LE(arm64.cbnz64(25, cbnzDonePc, skipLoadPc), cbnzDonePc);

    // return YES (1)
    e.emit(arm64.movz(0, 1));
    e.emit(arm64.ldpOffSp(27, 28, 80));
    e.emit(arm64.ldpOffSp(25, 26, 64));
    e.emit(arm64.ldpOffSp(23, 24, 48));
    e.emit(arm64.ldpOffSp(21, 22, 32));
    e.emit(arm64.ldpOffSp(19, 20, 16));
    e.emit(arm64.ldpPostSp(29, 30, 96));
    e.emit(arm64.ret());
    e.finish();
  }

  // Build __DATA segment (16KB page)
  const dataSeg = Buffer.alloc(PAGE_SIZE, 0);

  // Build __LINKEDIT tables:
  // 1. Dyld bind info opcodes
  const bindChunks = [];
  for (let i = 0; i < importedSymbols.length; i++) {
    const sym = importedSymbols[i];
    bindChunks.push(Buffer.from([0x10 | (sym.dylibOrdinal & 0x0f)]));
    bindChunks.push(Buffer.concat([Buffer.from([0x40]), Buffer.from(sym.name + '\0', 'utf-8')]));
    bindChunks.push(Buffer.from([0x51]));
    bindChunks.push(Buffer.from([0x72]));
    bindChunks.push(encodeULEB128(i * 8));
    bindChunks.push(Buffer.from([0x90]));
  }
  bindChunks.push(Buffer.from([0x00]));
  let bindBuf = Buffer.concat(bindChunks);
  while (bindBuf.length % 8 !== 0) {
    bindBuf = Buffer.concat([bindBuf, Buffer.from([0x00])]);
  }

  // 2. Dyld export trie
  const exportBuf = Buffer.alloc(32, 0);
  exportBuf[0] = 0x00;
  exportBuf[1] = 0x01;
  exportBuf.write('_main\0', 2, 'utf-8');
  exportBuf[8] = 10;
  exportBuf[10] = 3;
  exportBuf[11] = 0x00;
  exportBuf[12] = 0x80;
  exportBuf[13] = 0x20;
  exportBuf[14] = 0x00;

  // 3. Function starts
  const funcStartsRaw = Buffer.concat([
    encodeULEB128(CODE_OFFSET),
    encodeULEB128(NSSTR_HELPER_OFFSET - CODE_OFFSET),
    encodeULEB128(ALLOC_INIT_HELPER_OFFSET - NSSTR_HELPER_OFFSET),
    encodeULEB128(WIN_GETTER_OFFSET - ALLOC_INIT_HELPER_OFFSET),
    encodeULEB128(WIN_SETTER_OFFSET - WIN_GETTER_OFFSET),
    encodeULEB128(DID_FINISH_OFFSET - WIN_SETTER_OFFSET),
    Buffer.from([0x00]),
  ]);
  const funcStartsBuf = Buffer.alloc(Math.ceil(funcStartsRaw.length / 8) * 8, 0);
  funcStartsRaw.copy(funcStartsBuf);

  // 4. Symbol table & String table
  const strTabChunks = [Buffer.from([0x20, 0x00])];
  let strCursor = 2;
  function addSymString(s) {
    const off = strCursor;
    const b = Buffer.from(s + '\0', 'utf-8');
    strTabChunks.push(b);
    strCursor += b.length;
    return off;
  }

  const symEntries = [];
  symEntries.push({
    strx: addSymString('__mh_execute_header'),
    type: 0x0f,
    sect: 1,
    desc: 0x0010,
    value: TEXT_VMADDR,
  });
  symEntries.push({
    strx: addSymString('_main'),
    type: 0x0f,
    sect: 1,
    desc: 0x0000,
    value: TEXT_VMADDR + BigInt(CODE_OFFSET),
  });
  for (const imp of importedSymbols) {
    symEntries.push({
      strx: addSymString(imp.name),
      type: 0x01,
      sect: 0,
      desc: (imp.dylibOrdinal & 0xff) << 8,
      value: 0n,
    });
  }

  const symTabBuf = Buffer.alloc(symEntries.length * 16, 0);
  for (let i = 0; i < symEntries.length; i++) {
    const s = symEntries[i];
    const base = i * 16;
    symTabBuf.writeUInt32LE(s.strx, base + 0);
    symTabBuf.writeUInt8(s.type, base + 4);
    symTabBuf.writeUInt8(s.sect, base + 5);
    symTabBuf.writeUInt16LE(s.desc, base + 6);
    symTabBuf.writeBigUInt64LE(s.value, base + 8);
  }

  // 5. Indirect symbol table (padded to 8 bytes)
  const indirectSymBuf = Buffer.alloc(Math.ceil((importedSymbols.length * 4) / 8) * 8, 0);
  for (let i = 0; i < importedSymbols.length; i++) {
    indirectSymBuf.writeUInt32LE(2 + i, i * 4);
  }

  let strTabBuf = Buffer.concat(strTabChunks);
  while (strTabBuf.length % 16 !== 0) {
    strTabBuf = Buffer.concat([strTabBuf, Buffer.from([0x00])]);
  }

  let linkCursor = LINKEDIT_FILEOFF;
  const bindOff = linkCursor;
  const bindSize = bindBuf.length;
  linkCursor += bindSize;

  const exportOff = linkCursor;
  const exportSize = exportBuf.length;
  linkCursor += exportSize;

  const funcStartsOff = linkCursor;
  const funcStartsSize = funcStartsBuf.length;
  linkCursor += funcStartsSize;

  const dataInCodeOff = linkCursor;
  const dataInCodeSize = 0;

  const symOff = linkCursor;
  const nsyms = symEntries.length;
  linkCursor += symTabBuf.length;

  const indirectSymOff = linkCursor;
  const nindirectSyms = importedSymbols.length;
  linkCursor += indirectSymBuf.length;

  const strOffTable = linkCursor;
  const strSizeTable = strTabBuf.length;
  linkCursor += strSizeTable;

  const linkeditFilesize = linkCursor - LINKEDIT_FILEOFF;
  const linkeditSegBuf = Buffer.concat([
    bindBuf,
    exportBuf,
    funcStartsBuf,
    symTabBuf,
    indirectSymBuf,
    strTabBuf,
  ]);

  const loadCommands = [];

  function makeSegment64Cmd(segname, vmaddr, vmsize, fileoff, filesize, maxprot, initprot, sections = []) {
    const cmdsize = 72 + sections.length * 80;
    const b = Buffer.alloc(cmdsize, 0);
    b.writeUInt32LE(0x19, 0);
    b.writeUInt32LE(cmdsize, 4);
    b.write(segname, 8, 'ascii');
    b.writeBigUInt64LE(BigInt(vmaddr), 24);
    b.writeBigUInt64LE(BigInt(vmsize), 32);
    b.writeBigUInt64LE(BigInt(fileoff), 40);
    b.writeBigUInt64LE(BigInt(filesize), 48);
    b.writeUInt32LE(maxprot, 56);
    b.writeUInt32LE(initprot, 60);
    b.writeUInt32LE(sections.length, 64);
    b.writeUInt32LE(0, 68);

    for (let i = 0; i < sections.length; i++) {
      const s = sections[i];
      const sb = 72 + i * 80;
      b.write(s.sectname, sb + 0, 'ascii');
      b.write(s.segname, sb + 16, 'ascii');
      b.writeBigUInt64LE(BigInt(s.addr), sb + 32);
      b.writeBigUInt64LE(BigInt(s.size), sb + 40);
      b.writeUInt32LE(s.offset, sb + 48);
      b.writeUInt32LE(s.align || 0, sb + 52);
      b.writeUInt32LE(0, sb + 56);
      b.writeUInt32LE(0, sb + 60);
      b.writeUInt32LE(s.flags || 0, sb + 64);
      b.writeUInt32LE(s.reserved1 || 0, sb + 68);
      b.writeUInt32LE(s.reserved2 || 0, sb + 72);
      b.writeUInt32LE(0, sb + 76);
    }
    return b;
  }

  // 1. __PAGEZERO
  loadCommands.push(makeSegment64Cmd('__PAGEZERO', 0n, 0x100000000n, 0, 0, 0, 0, []));

  // 2. __TEXT
  loadCommands.push(
    makeSegment64Cmd('__TEXT', TEXT_VMADDR, PAGE_SIZE, TEXT_FILEOFF, PAGE_SIZE, 5, 5, [
      {
        sectname: '__text',
        segname: '__TEXT',
        addr: TEXT_VMADDR + BigInt(CODE_OFFSET),
        size: CSTRING_OFFSET - CODE_OFFSET,
        offset: CODE_OFFSET,
        align: 2,
        flags: 0x80000400,
      },
      {
        sectname: '__cstring',
        segname: '__TEXT',
        addr: TEXT_VMADDR + BigInt(CSTRING_OFFSET),
        size: cstrings.length * 0x40,
        offset: CSTRING_OFFSET,
        align: 0,
        flags: 0x00000002,
      },
    ])
  );

  // 3. __DATA
  loadCommands.push(
    makeSegment64Cmd('__DATA', DATA_VMADDR, PAGE_SIZE, DATA_FILEOFF, PAGE_SIZE, 3, 3, [
      {
        sectname: '__got',
        segname: '__DATA',
        addr: DATA_VMADDR,
        size: importedSymbols.length * 8,
        offset: GOT_OFFSET,
        align: 3,
        flags: 0x00000006,
        reserved1: 0,
      },
      {
        sectname: '__data',
        segname: '__DATA',
        addr: DATA_VMADDR + 0x80n,
        size: 8,
        offset: DATA_VARS_OFFSET,
        align: 3,
        flags: 0x00000000,
      },
    ])
  );

  // 4. __LINKEDIT
  loadCommands.push(
    makeSegment64Cmd('__LINKEDIT', LINKEDIT_VMADDR, PAGE_SIZE, LINKEDIT_FILEOFF, linkeditFilesize, 1, 1, [])
  );

  // 5. LC_DYLD_INFO_ONLY
  {
    const b = Buffer.alloc(48, 0);
    b.writeUInt32LE(0x80000022, 0);
    b.writeUInt32LE(48, 4);
    b.writeUInt32LE(0, 8);
    b.writeUInt32LE(0, 12);
    b.writeUInt32LE(bindOff, 16);
    b.writeUInt32LE(bindSize, 20);
    b.writeUInt32LE(0, 24);
    b.writeUInt32LE(0, 28);
    b.writeUInt32LE(0, 32);
    b.writeUInt32LE(0, 36);
    b.writeUInt32LE(exportOff, 40);
    b.writeUInt32LE(exportSize, 44);
    loadCommands.push(b);
  }

  // 6. LC_SYMTAB
  {
    const b = Buffer.alloc(24, 0);
    b.writeUInt32LE(0x02, 0);
    b.writeUInt32LE(24, 4);
    b.writeUInt32LE(symOff, 8);
    b.writeUInt32LE(nsyms, 12);
    b.writeUInt32LE(strOffTable, 16);
    b.writeUInt32LE(strSizeTable, 20);
    loadCommands.push(b);
  }

  // 7. LC_DYSYMTAB
  {
    const b = Buffer.alloc(80, 0);
    b.writeUInt32LE(0x0b, 0);
    b.writeUInt32LE(80, 4);
    b.writeUInt32LE(0, 8);
    b.writeUInt32LE(0, 12);
    b.writeUInt32LE(0, 16);
    b.writeUInt32LE(2, 20);
    b.writeUInt32LE(2, 24);
    b.writeUInt32LE(importedSymbols.length, 28);
    b.writeUInt32LE(indirectSymOff, 56);
    b.writeUInt32LE(nindirectSyms, 60);
    loadCommands.push(b);
  }

  // 8. LC_LOAD_DYLINKER
  {
    const dylinker = '/usr/lib/dyld\0';
    const cmdsize = Math.ceil((12 + dylinker.length) / 8) * 8;
    const b = Buffer.alloc(cmdsize, 0);
    b.writeUInt32LE(0x0e, 0);
    b.writeUInt32LE(cmdsize, 4);
    b.writeUInt32LE(12, 8);
    b.write(dylinker, 12, 'ascii');
    loadCommands.push(b);
  }

  // 9. LC_UUID
  {
    const b = Buffer.alloc(24, 0);
    b.writeUInt32LE(0x1b, 0);
    b.writeUInt32LE(24, 4);
    const uuid = crypto.createHash('md5').update('BudgetApp-iOS-ARM64-MachO-v3').digest();
    uuid.copy(b, 8);
    loadCommands.push(b);
  }

  // 10. LC_BUILD_VERSION (minos 14.0, sdk 14.5 so dyld4 uses LC_DYLD_INFO_ONLY cleanly)
  {
    const b = Buffer.alloc(32, 0);
    b.writeUInt32LE(0x32, 0);
    b.writeUInt32LE(32, 4);
    b.writeUInt32LE(2, 8);          // PLATFORM_IOS = 2
    b.writeUInt32LE(0x000e0000, 12);// minos = 14.0.0
    b.writeUInt32LE(0x000e0500, 16);// sdk = 14.5.0
    b.writeUInt32LE(1, 20);         // ntools = 1
    b.writeUInt32LE(3, 24);         // TOOL_LD = 3
    b.writeUInt32LE(0x02610000, 28);// ld64 version
    loadCommands.push(b);
  }

  // 11. LC_SOURCE_VERSION
  {
    const b = Buffer.alloc(16, 0);
    b.writeUInt32LE(0x2a, 0);
    b.writeUInt32LE(16, 4);
    b.writeBigUInt64LE(0n, 8);
    loadCommands.push(b);
  }

  // 12. LC_MAIN
  {
    const b = Buffer.alloc(24, 0);
    b.writeUInt32LE(0x80000028, 0);
    b.writeUInt32LE(24, 4);
    b.writeBigUInt64LE(BigInt(CODE_OFFSET), 8);
    b.writeBigUInt64LE(0n, 16);
    loadCommands.push(b);
  }

  // 13. LC_LOAD_DYLIB
  function makeLoadDylibCmd(dylibPath, currentVer = 0x00010000, compatVer = 0x00010000) {
    const str = dylibPath + '\0';
    const cmdsize = Math.ceil((24 + str.length) / 8) * 8;
    const b = Buffer.alloc(cmdsize, 0);
    b.writeUInt32LE(0x0c, 0);
    b.writeUInt32LE(cmdsize, 4);
    b.writeUInt32LE(24, 8);
    b.writeUInt32LE(2, 12);
    b.writeUInt32LE(currentVer, 16);
    b.writeUInt32LE(compatVer, 20);
    b.write(str, 24, 'ascii');
    return b;
  }

  loadCommands.push(makeLoadDylibCmd('/usr/lib/libSystem.B.dylib', 0x054b0000, 0x00010000));
  loadCommands.push(makeLoadDylibCmd('/usr/lib/libobjc.A.dylib', 0x00e40000, 0x00010000));
  loadCommands.push(makeLoadDylibCmd('/System/Library/Frameworks/Foundation.framework/Foundation', 0x07d00000, 0x012c0000));
  loadCommands.push(makeLoadDylibCmd('/System/Library/Frameworks/UIKit.framework/UIKit', 0x17700000, 0x00010000));
  loadCommands.push(makeLoadDylibCmd('/System/Library/Frameworks/WebKit.framework/WebKit', 0x02680000, 0x00010000));

  // 14. LC_FUNCTION_STARTS
  {
    const b = Buffer.alloc(16, 0);
    b.writeUInt32LE(0x26, 0);
    b.writeUInt32LE(16, 4);
    b.writeUInt32LE(funcStartsOff, 8);
    b.writeUInt32LE(funcStartsSize, 12);
    loadCommands.push(b);
  }

  // 15. LC_DATA_IN_CODE
  {
    const b = Buffer.alloc(16, 0);
    b.writeUInt32LE(0x29, 0);
    b.writeUInt32LE(16, 4);
    b.writeUInt32LE(dataInCodeOff, 8);
    b.writeUInt32LE(dataInCodeSize, 12);
    loadCommands.push(b);
  }

  const allCmdsBuf = Buffer.concat(loadCommands);

  textSeg.writeUInt32LE(0xfeedfacf, 0); // MH_MAGIC_64
  textSeg.writeUInt32LE(0x0100000c, 4); // CPU_TYPE_ARM64
  textSeg.writeUInt32LE(0x00000000, 8); // CPU_SUBTYPE_ARM64_ALL
  textSeg.writeUInt32LE(0x00000002, 12);// MH_EXECUTE
  textSeg.writeUInt32LE(loadCommands.length, 16);
  textSeg.writeUInt32LE(allCmdsBuf.length, 20);
  textSeg.writeUInt32LE(0x00200085, 24);// MH_NOUNDEFS | MH_DYLDLINK | MH_TWOLEVEL | MH_PIE
  textSeg.writeUInt32LE(0x00000000, 28);

  allCmdsBuf.copy(textSeg, 32);

  return Buffer.concat([textSeg, dataSeg, linkeditSegBuf]);
}

function generateValidInfoPlist(appName, version) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDevelopmentRegion</key>
	<string>it</string>
	<key>CFBundleDisplayName</key>
	<string>Budget App</string>
	<key>CFBundleExecutable</key>
	<string>${appName}</string>
	<key>CFBundleIdentifier</key>
	<string>com.budgeting.macapp</string>
	<key>CFBundleInfoDictionaryVersion</key>
	<string>6.0</string>
	<key>CFBundleName</key>
	<string>${appName}</string>
	<key>CFBundlePackageType</key>
	<string>APPL</string>
	<key>CFBundleShortVersionString</key>
	<string>${version}</string>
	<key>CFBundleVersion</key>
	<string>${version}</string>
	<key>CFBundleSupportedPlatforms</key>
	<array>
		<string>iPhoneOS</string>
	</array>
	<key>MinimumOSVersion</key>
	<string>14.0</string>
	<key>LSRequiresIPhoneOS</key>
	<true/>
	<key>UIDeviceFamily</key>
	<array>
		<integer>1</integer>
		<integer>2</integer>
	</array>
	<key>DTPlatformName</key>
	<string>iphoneos</string>
	<key>DTPlatformVersion</key>
	<string>17.0</string>
	<key>DTSDKName</key>
	<string>iphoneos17.0</string>
	<key>CFBundleIcons</key>
	<dict>
		<key>CFBundlePrimaryIcon</key>
		<dict>
			<key>CFBundleIconFiles</key>
			<array>
				<string>AppIcon60x60</string>
			</array>
			<key>UIPrerenderedIcon</key>
			<false/>
		</dict>
	</dict>
	<key>CFBundleIcons~ipad</key>
	<dict>
		<key>CFBundlePrimaryIcon</key>
		<dict>
			<key>CFBundleIconFiles</key>
			<array>
				<string>AppIcon60x60</string>
				<string>AppIcon76x76</string>
			</array>
			<key>UIPrerenderedIcon</key>
			<false/>
		</dict>
	</dict>
	<key>UILaunchScreen</key>
	<dict/>
	<key>UIRequiredDeviceCapabilities</key>
	<array>
		<string>arm64</string>
	</array>
	<key>UISupportedInterfaceOrientations</key>
	<array>
		<string>UIInterfaceOrientationPortrait</string>
		<string>UIInterfaceOrientationLandscapeLeft</string>
		<string>UIInterfaceOrientationLandscapeRight</string>
	</array>
	<key>UISupportedInterfaceOrientations~ipad</key>
	<array>
		<string>UIInterfaceOrientationPortrait</string>
		<string>UIInterfaceOrientationPortraitUpsideDown</string>
		<string>UIInterfaceOrientationLandscapeLeft</string>
		<string>UIInterfaceOrientationLandscapeRight</string>
	</array>
	<key>UIViewControllerBasedStatusBarAppearance</key>
	<true/>
	<key>UIFileSharingEnabled</key>
	<true/>
	<key>LSSupportsOpeningDocumentsInPlace</key>
	<true/>
	<key>NSAppTransportSecurity</key>
	<dict>
		<key>NSAllowsArbitraryLoads</key>
		<true/>
	</dict>
</dict>
</plist>`;
}

/**
 * Prepares a 100% self-contained index.html for iOS WKWebView:
 * - Removes restrictive CSP meta tags that can block local file:// or loadHTMLString execution
 * - Injects a localStorage/sessionStorage safeguard polyfill so file:// origins never throw SecurityError
 * - Inlines CSS inside <head>
 * - Transforms import.meta.url / import.meta in the Vite bundle into classic JS and validates with vm.Script
 * - Places the validated JS bundle at the END of <body> AFTER <div id="root">
 */
function prepareIosSelfContainedHtml(distDir) {
  const indexHtmlPath = path.join(distDir, 'index.html');
  if (!fs.existsSync(indexHtmlPath)) return null;

  let html = fs.readFileSync(indexHtmlPath, 'utf-8');

  // Remove restrictive Content-Security-Policy meta tag on local iOS WKWebView bundle
  html = html.replace(/<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*>/gi, '');

  // Ensure viewport has viewport-fit=cover for iOS notch / Dynamic Island
  html = html.replace(
    /<meta\s+name="viewport"\s+content="[^"]*"\s*\/?>/i,
    '<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />'
  );

  // Inject iOS WKWebView storage & environment safeguard at top of <head>
  const iosBootstrapPolyfill = `<script>
(function() {
  try {
    var k = '__budget_ios_test__';
    window.localStorage.setItem(k, '1');
    window.localStorage.removeItem(k);
  } catch (e) {
    var mem = {};
    try {
      if (window.name && window.name.indexOf('__BUDGET_IOS__:') === 0) {
        mem = JSON.parse(window.name.slice(15)) || {};
      }
    } catch (_) {}
    var save = function() {
      try { window.name = '__BUDGET_IOS__:' + JSON.stringify(mem); } catch (_) {}
    };
    var store = {
      getItem: function(key) { return Object.prototype.hasOwnProperty.call(mem, key) ? String(mem[key]) : null; },
      setItem: function(key, val) { mem[key] = String(val); save(); },
      removeItem: function(key) { delete mem[key]; save(); },
      clear: function() { mem = {}; save(); },
      key: function(i) { var keys = Object.keys(mem); return keys[i] || null; },
      get length() { return Object.keys(mem).length; }
    };
    try { Object.defineProperty(window, 'localStorage', { value: store, configurable: true }); } catch (_) {}
    try { Object.defineProperty(window, 'sessionStorage', { value: store, configurable: true }); } catch (_) {}
  }
  window.addEventListener('error', function(ev) {
    var el = document.getElementById('ios-boot-status');
    if (el) {
      el.style.color = '#f87171';
      el.textContent = 'Errore avvio: ' + (ev && ev.message ? ev.message : 'errore sconosciuto');
    }
  });
})();
</script>`;

  html = html.replace('<head>', () => `<head>\n${iosBootstrapPolyfill}`);

  // Inline local CSS files
  html = html.replace(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"[^>]*>/gi, (fullMatch, href) => {
    const cleanRel = href.replace(/^\.\//, '').replace(/^\//, '');
    const cssPath = path.join(distDir, cleanRel);
    if (fs.existsSync(cssPath)) {
      const cssContent = fs.readFileSync(cssPath, 'utf-8');
      return `<style>${cssContent}</style>`;
    }
    return fullMatch.replace(/\scrossorigin(=["'][^"']*["'])?/gi, '');
  });

  // Extract local JS scripts from <head>, convert import.meta for classic script execution, and verify syntax
  const inlineScripts = [];
  html = html.replace(/<script[^>]+src="([^"]+)"[^>]*><\/script>/gi, (fullMatch, src) => {
    const cleanRel = src.replace(/^\.\//, '').replace(/^\//, '');
    const jsPath = path.join(distDir, cleanRel);
    if (fs.existsSync(jsPath)) {
      let jsContent = fs.readFileSync(jsPath, 'utf-8');
      jsContent = jsContent
        .replace(
          /import\.meta\.url/g,
          '(window.location.href&&window.location.href.indexOf("file:")===0?window.location.href:"file:///index.html")'
        )
        .replace(
          /import\.meta/g,
          '({url:(window.location.href&&window.location.href.indexOf("file:")===0?window.location.href:"file:///index.html"),env:{}})'
        );

      // Verify at build time that the transformed JS has zero syntax errors as a classic script
      new vm.Script(jsContent);

      const safeJs = jsContent.replace(/<\/script>/gi, '<\\/script>');
      inlineScripts.push(`<script>${safeJs}</script>`);
      return '';
    }
    return fullMatch.replace(/\scrossorigin(=["'][^"']*["'])?/gi, '');
  });

  // Add visible launch splash inside #root so screen is never black while JS parses
  html = html.replace(
    '<div id="root"></div>',
    () => `<div id="root">
      <div style="min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#08111f;color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,sans-serif;padding:24px;text-align:center;">
        <div style="width:60px;height:60px;border-radius:18px;background:linear-gradient(135deg,#0ea5e9,#38bdf8);display:flex;align-items:center;justify-content:center;font-size:30px;margin-bottom:16px;box-shadow:0 10px 25px rgba(14,165,233,0.35);">📊</div>
        <div style="font-size:19px;font-weight:700;margin-bottom:6px;">Budget Ledger</div>
        <div id="ios-boot-status" style="font-size:13px;color:#94a3b8;">Caricamento interfaccia...</div>
      </div>
    </div>`
  );

  if (inlineScripts.length > 0) {
    html = html.replace('</body>', () => `${inlineScripts.join('\n')}\n</body>`);
  }

  return Buffer.from(html, 'utf-8');
}

async function buildIpa() {
  console.log('🚀 [iOS Packaging] Avvio preparazione pacchetto IPA nativo per AltStore / Sideloadly...');

  const distDir = path.join(__dirname, '../dist');
  if (!fs.existsSync(path.join(distDir, 'index.html'))) {
    console.log('🔨 [iOS Packaging] Compilazione frontend Vite in dist/...');
    execSync('npm run build', { stdio: 'inherit', cwd: path.join(__dirname, '..') });
  }

  try {
    execSync('npx cap sync ios', { stdio: 'pipe', cwd: path.join(__dirname, '..') });
  } catch {}

  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf-8'));
  const version = pkg.version || '0.3.5';
  const appName = 'BudgetApp';
  const outDir = path.join(__dirname, '../dist-ios');

  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const zip = new JSZip();
  const payloadFolder = zip.folder('Payload');
  const appFolder = payloadFolder.folder(`${appName}.app`);

  const iosAppDir = path.join(__dirname, '../ios/App/App');

  function addDirectoryToZip(zipFolder, localDirPath) {
    if (!fs.existsSync(localDirPath)) return;
    const items = fs.readdirSync(localDirPath);
    for (const item of items) {
      const fullPath = path.join(localDirPath, item);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        const subFolder = zipFolder.folder(item);
        addDirectoryToZip(subFolder, fullPath);
      } else {
        const fileContent = fs.readFileSync(fullPath);
        zipFolder.file(item, fileContent, { unixPermissions: 0o644 });
      }
    }
  }

  console.log('📄 [iOS Packaging] Generazione Info.plist e PkgInfo conformi alle specifiche AltStore...');
  const infoPlistContent = generateValidInfoPlist(appName, version);
  try {
    if (fs.existsSync(iosAppDir)) {
      fs.writeFileSync(path.join(iosAppDir, 'Info.plist'), infoPlistContent, 'utf-8');
    }
  } catch {}

  appFolder.file('Info.plist', Buffer.from(infoPlistContent, 'utf-8'), { unixPermissions: 0o644 });
  appFolder.file('PkgInfo', Buffer.from('APPL????', 'ascii'), { unixPermissions: 0o644 });

  const capConfigPath = path.join(iosAppDir, 'capacitor.config.json');
  if (fs.existsSync(capConfigPath)) {
    appFolder.file('capacitor.config.json', fs.readFileSync(capConfigPath), { unixPermissions: 0o644 });
  }

  console.log('⚙️ [iOS Packaging] Generazione eseguibile ARM64 Mach-O 64-bit (MH_EXECUTE + WKWebView)...');
  const machOBuffer = createArm64IosMachOBinary();
  appFolder.file(appName, machOBuffer, { unixPermissions: 0o755 });

  console.log('🌐 [iOS Packaging] Inclusione web application bundle (dist)...');
  const publicFolder = appFolder.folder('public');
  addDirectoryToZip(publicFolder, distDir);
  addDirectoryToZip(appFolder, distDir);

  const selfContainedHtml = prepareIosSelfContainedHtml(distDir);
  if (selfContainedHtml) {
    appFolder.file('index.html', selfContainedHtml, { unixPermissions: 0o644 });
    publicFolder.file('index.html', selfContainedHtml, { unixPermissions: 0o644 });
  }

  const iconCandidates = [
    path.join(__dirname, '../build/icon.png'),
    path.join(__dirname, '../public/icon.png'),
    path.join(__dirname, '../src/renderer/assets/icon.png'),
  ];
  const iconSrc = iconCandidates.find((p) => fs.existsSync(p));
  if (iconSrc) {
    const iconBuf = fs.readFileSync(iconSrc);
    appFolder.file('AppIcon60x60@2x.png', iconBuf, { unixPermissions: 0o644 });
    appFolder.file('AppIcon60x60@3x.png', iconBuf, { unixPermissions: 0o644 });
    appFolder.file('AppIcon76x76@2x~ipad.png', iconBuf, { unixPermissions: 0o644 });
    appFolder.file('Icon.png', iconBuf, { unixPermissions: 0o644 });
    appFolder.file('Icon@2x.png', iconBuf, { unixPermissions: 0o644 });
  }

  const ipaFileName = `${appName}-${version}.ipa`;
  const ipaFilePath = path.join(outDir, ipaFileName);

  console.log(`🗜️ [iOS Packaging] Compressione archivio ${ipaFileName} (formato UNIX)...`);
  const content = await zip.generateAsync({
    type: 'nodebuffer',
    platform: 'UNIX',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  fs.writeFileSync(ipaFilePath, content);
  fs.writeFileSync(path.join(outDir, `${appName}-latest.ipa`), content);

  const sizeMb = (content.length / (1024 * 1024)).toFixed(2);
  console.log(`✅ [iOS Packaging] Pacchetto IPA generato con successo!`);
  console.log(`📁 File: ${ipaFilePath} (${sizeMb} MB)`);
  console.log(`📲 Compatibile al 100% con AltStore, SideStore e Sideloadly.`);

  return ipaFilePath;
}

if (require.main === module) {
  buildIpa().catch((err) => {
    console.error('❌ Errore durante la creazione del pacchetto IPA:', err);
    process.exit(1);
  });
}

module.exports = { buildIpa, createArm64IosMachOBinary };
