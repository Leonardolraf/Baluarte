*** Settings ***
Documentation     Teste automatizado de interface web — Alterar Senha (Baluarte).
...               Técnica de modelagem: Análise de Valor de Borda (comprimento da nova senha: mínimo 8, máximo 64).
Library           SeleniumLibrary
Suite Setup       Abrir o navegador na tela de alterar senha
Suite Teardown    Fechar o navegador

*** Variables ***
${URL}           http://localhost:3000/alterar-senha
${BROWSER}       chrome
${OPCOES}        add_argument("--headless=new"); add_argument("--no-sandbox"); add_argument("--disable-dev-shm-usage"); add_argument("--window-size=1280,900")
${ATUAL}         id=senhaAtual
${NOVA}          id=novaSenha
${CONFIRMA}      id=confirmarSenha
${BOTAO}         id=btnAlterar
${MENSAGEM}      id=mensagem

*** Test Cases ***
CT01 - Fronteira abaixo do mínimo (7 caracteres) deve falhar
    Preencher    Senha@123    Abc@123    Abc@123
    Alterar
    A mensagem exibida deve ser    A nova senha deve ter no mínimo 8 caracteres

CT02 - Fronteira no mínimo (8 caracteres) deve aceitar
    Preencher    Senha@123    Abc@1234    Abc@1234
    Alterar
    A mensagem exibida deve ser    Senha alterada com sucesso

CT03 - Fronteira no máximo (64 caracteres) deve aceitar
    ${s64}=    Evaluate    "Aa1@bcde" * 8
    Preencher    Senha@123    ${s64}    ${s64}
    Alterar
    A mensagem exibida deve ser    Senha alterada com sucesso

CT04 - Fronteira acima do máximo (65 caracteres) deve falhar
    ${s64}=    Evaluate    "Aa1@bcde" * 8
    ${s65}=    Set Variable    ${s64}x
    Preencher    Senha@123    ${s65}    ${s65}
    Alterar
    A mensagem exibida deve ser    A nova senha deve ter no máximo 64 caracteres

CT05 - Confirmação divergente deve falhar
    Preencher    Senha@123    Abc@1234    Xyz@9999
    Alterar
    A mensagem exibida deve ser    As senhas não conferem

*** Keywords ***
Abrir o navegador na tela de alterar senha
    Open Browser    ${URL}    ${BROWSER}    options=${OPCOES}

Preencher
    [Arguments]    ${vAtual}    ${vNova}    ${vConfirma}
    Reload Page
    Wait Until Element Is Visible    ${ATUAL}    timeout=5s
    Input Password    ${ATUAL}       ${vAtual}
    Input Password    ${NOVA}        ${vNova}
    Input Password    ${CONFIRMA}    ${vConfirma}

Alterar
    Click Element    ${BOTAO}

A mensagem exibida deve ser
    [Arguments]    ${esperado}
    Wait Until Element Contains    ${MENSAGEM}    ${esperado}    timeout=5s
    Capture Page Screenshot

Fechar o navegador
    Close Browser
