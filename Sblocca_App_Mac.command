#!/bin/bash
# Script di sblocco automatico per macOS
clear
echo "========================================================="
echo "   SBLOCCO DI BUDGETING MAC APP (RIMUOVI QUARANTENA)   "
echo "========================================================="
echo ""
echo "Questo script sblocca l'applicazione se macOS mostra l'errore"
echo "'App danneggiata' dovuto alla mancanza di firma Apple ufficiale."
echo ""

# Cambia directory a quella in cui si trova lo script
cd "$(dirname "$0")"

# Verifica se l'app è in /Applications
if [ -d "/Applications/BudgetingMacApp.app" ]; then
    echo "Rilevata l'app nella cartella Applicazioni di sistema."
    echo "Rimozione quarantena in corso..."
    xattr -cr /Applications/BudgetingMacApp.app 2>/dev/null
    sudo xattr -cr /Applications/BudgetingMacApp.app 2>/dev/null
    
    echo ""
    echo "SBLOCCO COMPLETATO CON SUCCESSO! 🎉"
    echo "Ora puoi aprire l'applicazione normalmente dal Launchpad o dalla cartella Applicazioni."
else
    # Se non è in /Applications, controlla se si trova nella stessa cartella dello script
    if [ -d "BudgetingMacApp.app" ]; then
        echo "Rilevata l'app nella cartella corrente."
        echo "Rimozione quarantena in corso..."
        xattr -cr BudgetingMacApp.app 2>/dev/null
        sudo xattr -cr BudgetingMacApp.app 2>/dev/null
        
        echo ""
        echo "SBLOCCO COMPLETATO CON SUCCESSO! 🎉"
        echo "Ora puoi aprire l'applicazione normalmente."
    else
        echo "ATTENZIONE: Sposta prima l'applicazione 'BudgetingMacApp' nella cartella 'Applicazioni'."
        echo "In alternativa, trascina l'applicazione 'BudgetingMacApp' qui dentro per sbloccarla:"
        echo ""
        read -p "Trascina l'app qui e premi Invio: " APP_PATH
        
        # Pulisce eventuali caratteri di escape inseriti dal drag-and-drop
        APP_PATH="${APP_PATH//\'/}"
        APP_PATH="${APP_PATH//\"/}"
        APP_PATH="${APP_PATH//\\ / }"
        
        if [ -d "$APP_PATH" ]; then
            echo "Rimozione quarantena per: $APP_PATH"
            xattr -cr "$APP_PATH" 2>/dev/null
            sudo xattr -cr "$APP_PATH" 2>/dev/null
            echo ""
            echo "SBLOCCO COMPLETATO CON SUCCESSO! 🎉"
        else
            echo ""
            echo "❌ Percorso non trovato o non valido. Assicurati che l'app sia installata correttamente."
            echo "Puoi farlo manualmente eseguendo questo comando nel Terminale:"
            echo "xattr -cr /Applications/BudgetingMacApp.app"
        fi
    fi
fi

echo ""
echo "Premi Invio per chiudere questa finestra..."
read -r
