*** Settings ***
Documentation     Teste automatizado de interface web — Cadastro de Ativo (Baluarte).
...               Técnica de modelagem: Partição de Equivalência (nome, tipo e host em classes válidas/inválidas).
Library           SeleniumLibrary
Suite Setup       Abrir o navegador na tela de cadastro de ativo
Suite Teardown    Fechar o navegador

*** Variables ***
${URL}          http://localhost:3000/cadastro-ativo
${BROWSER}      chrome
${OPCOES}       add_argument("--headless=new"); add_argument("--no-sandbox"); add_argument("--disable-dev-shm-usage"); add_argument("--window-size=1280,900")
${NOME}         id=nome
${TIPO}         id=tipo
${HOST}         id=host
${BOTAO}        id=btnCadastrar
${MENSAGEM}     id=mensagem

*** Test Cases ***
CT01 - Deve cadastrar ativo válido (CE1)
    Preencher ativo    Firewall Borda    Rede    10.0.0.5
    Cadastrar
    A mensagem exibida deve ser    Ativo cadastrado com sucesso

CT02 - Deve exigir nome (CE2)
    Preencher ativo    ${EMPTY}    Rede    10.0.0.6
    Cadastrar
    A mensagem exibida deve ser    Nome do ativo é obrigatório

CT03 - Deve exigir tipo (CE3)
    Preencher ativo    Firewall Borda    ${EMPTY}    10.0.0.7
    Cadastrar
    A mensagem exibida deve ser    Tipo é obrigatório

CT04 - Deve validar host inválido (CE4)
    Preencher ativo    Firewall Borda    Rede    999.1.1.1
    Cadastrar
    A mensagem exibida deve ser    Host inválido

CT05 - Deve bloquear host duplicado (CE5)
    Preencher ativo    Firewall Borda    Rede    192.168.0.10
    Cadastrar
    A mensagem exibida deve ser    Ativo já cadastrado

*** Keywords ***
Abrir o navegador na tela de cadastro de ativo
    Open Browser    ${URL}    ${BROWSER}    options=${OPCOES}

Preencher ativo
    [Arguments]    ${vNome}    ${vTipo}    ${vHost}
    Reload Page
    Wait Until Element Is Visible    ${NOME}    timeout=5s
    Input Text    ${NOME}    ${vNome}
    IF    '${vTipo}' != ''
        Select From List By Value    ${TIPO}    ${vTipo}
    END
    Input Text    ${HOST}    ${vHost}

Cadastrar
    Click Element    ${BOTAO}

A mensagem exibida deve ser
    [Arguments]    ${esperado}
    Wait Until Element Contains    ${MENSAGEM}    ${esperado}    timeout=5s
    Capture Page Screenshot

Fechar o navegador
    Close Browser
