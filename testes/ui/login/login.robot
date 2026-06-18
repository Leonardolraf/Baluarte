*** Settings ***
Documentation     Teste automatizado de interface web — Login (Baluarte).
...               Técnica de modelagem: Partição de Equivalência (e-mail e senha em classes válidas/inválidas).
Library           SeleniumLibrary
Suite Setup       Abrir o navegador na tela de login
Suite Teardown    Fechar o navegador

*** Variables ***
${URL}          http://localhost:3000/login.html
${BROWSER}      chrome
${OPCOES}       add_argument("--headless=new"); add_argument("--no-sandbox"); add_argument("--disable-dev-shm-usage"); add_argument("--window-size=1280,900")
${EMAIL}        id=email
${SENHA}        id=senha
${BOTAO}        id=btnEntrar
${MENSAGEM}     id=mensagem

*** Test Cases ***
CT01 - Deve autenticar com credenciais válidas (CE1)
    Preencher login    analista@empresa.com    Senha@123
    Entrar
    A mensagem exibida deve ser    Login realizado com sucesso

CT02 - Deve exigir e-mail (CE2)
    Preencher login    ${EMPTY}    Senha@123
    Entrar
    A mensagem exibida deve ser    E-mail é obrigatório

CT03 - Deve validar formato de e-mail (CE3)
    Preencher login    analista-empresa.com    Senha@123
    Entrar
    A mensagem exibida deve ser    Formato de e-mail inválido

CT04 - Deve exigir senha (CE4)
    Preencher login    analista@empresa.com    ${EMPTY}
    Entrar
    A mensagem exibida deve ser    Senha é obrigatória

CT05 - Deve rejeitar credenciais inválidas (CE5)
    Preencher login    analista@empresa.com    SenhaErrada
    Entrar
    A mensagem exibida deve ser    E-mail ou senha inválidos

*** Keywords ***
Abrir o navegador na tela de login
    Open Browser    ${URL}    ${BROWSER}    options=${OPCOES}

Preencher login
    [Arguments]    ${vEmail}    ${vSenha}
    Reload Page
    Wait Until Element Is Visible    ${EMAIL}    timeout=5s
    Input Text        ${EMAIL}    ${vEmail}
    Input Password    ${SENHA}    ${vSenha}

Entrar
    Click Element    ${BOTAO}

A mensagem exibida deve ser
    [Arguments]    ${esperado}
    Wait Until Element Contains    ${MENSAGEM}    ${esperado}    timeout=5s
    Capture Page Screenshot

Fechar o navegador
    Close Browser
