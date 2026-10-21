import os
import sys
import zipfile

def create_mac_zip(source_dir, output_zip):
    print(f"Creating {output_zip} from {source_dir}...")
    base_dir = os.path.dirname(source_dir)
    
    with zipfile.ZipFile(output_zip, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for root, dirs, files in os.walk(source_dir, followlinks=False):
            # Record directories
            for d in dirs:
                full_dir = os.path.join(root, d)
                rel_dir = os.path.relpath(full_dir, base_dir) + '/'
                if os.path.islink(full_dir):
                    zi = zipfile.ZipInfo(rel_dir[:-1])
                    zi.create_system = 3
                    zi.external_attr = 0o120777 << 16
                    zf.writestr(zi, os.readlink(full_dir))
                else:
                    zi = zipfile.ZipInfo(rel_dir)
                    zi.create_system = 3
                    zi.external_attr = 0o755 << 16
                    zf.writestr(zi, '')

            for f in files:
                full_path = os.path.join(root, f)
                rel_path = os.path.relpath(full_path, base_dir)
                if os.path.islink(full_path):
                    zi = zipfile.ZipInfo(rel_path)
                    zi.create_system = 3
                    zi.external_attr = 0o120777 << 16
                    target = os.readlink(full_path)
                    zf.writestr(zi, target)
                else:
                    zi = zipfile.ZipInfo(rel_path)
                    zi.create_system = 3
                    st = os.stat(full_path)
                    zi.external_attr = (st.st_mode & 0xFFFF) << 16
                    with open(full_path, 'rb') as fp:
                        zf.writestr(zi, fp.read(), compress_type=zipfile.ZIP_DEFLATED)

    size_mb = os.path.getsize(output_zip) / (1024 * 1024)
    print(f"Successfully created {output_zip} ({size_mb:.1f} MB)")

if __name__ == '__main__':
    src = sys.argv[1] if len(sys.argv) > 1 else 'dist-electron/mac/BudgetingMacApp.app'
    out = sys.argv[2] if len(sys.argv) > 2 else 'dist-electron/BudgetingMacApp-0.3.0-mac.zip'
    create_mac_zip(src, out)
