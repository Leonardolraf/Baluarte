*** Settings ***
Documentation     Teste automatizado de interface web — Redefinir Senha (Baluarte).
...               Técnica de modelagem: Tabela de Decisão (R1 token válido, R2 senha >= 8, R3 confirmação igual).
Library           SeleniumLibrary
Suite Setup       Abrir o navegador na tela de redefinir senha
Suite Teardown    Fechar o navegador

*** Variables ***
${URL}          http://localhost:3000/reset-senha
${BROWSER}      chrome
${OPCOES}       add_argument("--headless=new"); add_argument("--no-sandbox"); add_argument("--disable-dev-shm-usage"); add_argument("--window-size=1280,900")
${TOKEN}        id=token
${NOVA}         id=novaSenha
${CONFIRMA}     id=confirmarSenha
${BOTAO}        id=btnRedefinir
${MENSAGEM}     id=mensagem

*** Test Cases ***
CT01 - R1..R3 = S deve redefinir a senha
    Preencher    TOKEN-VALIDO-123    NovaSenha1    NovaSenha1
    Redefinir
    A mensagem exibida deve ser    Senha redefinida com sucesso

CT02 - R1 = N token inválido
    Preencher    TOKEN-ERRADO    NovaSenha1    NovaSenha1
    Redefinir
    A mensagem exibida deve ser    Token inválido ou expirado

CT03 - R2 = N senha curta
    Preencher    TOKEN-VALIDO-123    123    123
    Redefinir
    A mensagem exibida deve ser    A senha deve ter no mínimo 8 caracteres

CT04 - R3 = N confirmação divergente
    Preencher    TOKEN-VALIDO-123    NovaSenha1    Outra123
    Redefinir
    A mensagem exibida deve ser    As senhas não conferem

*** Keywords ***
Abrir o navegador na tela de redefinir senha
    Open Browser    ${URL}    ${BROWSER}    options=${OPCOES}

Preencher
    [Arguments]    ${vToken}    ${vNova}    ${vConfirma}
    Reload Page
    Wait Until Element Is Visible    ${TOKEN}    timeout=5s
    Input Text        ${TOKEN}       ${vToken}
    Input Password    ${NOVA}        ${vNova}
    Input Password    ${CONFIRMA}    ${vConfirma}

Redefinir
    Click Element    ${BOTAO}

A mensagem exibida deve ser
    [Arguments]    ${esperado}
    Wait Until Element Contains    ${MENSAGEM}    ${esperado}    timeout=5s
    Capture Page Screenshot

Fechar o navegador
    Close Browser
