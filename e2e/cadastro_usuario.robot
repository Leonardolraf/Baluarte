*** Settings ***
Documentation     Teste automatizado de interface web — Cadastro de Usuário (Baluarte).
...               Técnica de modelagem: Tabela de Decisão
...               (R1 nome preenchido, R2 e-mail válido, R3 senha >= 8, R4 confirmação igual à senha).
Library           SeleniumLibrary
Suite Setup       Abrir o navegador na tela de cadastro
Suite Teardown    Fechar o navegador

*** Variables ***
${URL}                http://localhost:3000/cadastro-usuario
${BROWSER}            chrome
${OPCOES}             add_argument("--headless=new"); add_argument("--no-sandbox"); add_argument("--disable-dev-shm-usage"); add_argument("--window-size=1280,900")
${INPUT_NOME}         id=nome
${INPUT_EMAIL}        id=email
${INPUT_SENHA}        id=senha
${INPUT_CONFIRMAR}    id=confirmarSenha
${BOTAO_CADASTRAR}    id=btnCadastrar
${MENSAGEM}           id=mensagem

*** Test Cases ***
CT01 - Deve cadastrar com dados válidos (R1..R4 = S)
    [Documentation]    Regra: todas as condições satisfeitas -> cadastro realizado.
    Preencher cadastro    João Silva    joao@email.com    12345678    12345678
    Solicitar o cadastro
    A mensagem exibida deve ser    Cadastro realizado com sucesso

CT02 - Deve exigir nome (R1 = N)
    Preencher cadastro    ${EMPTY}    joao@email.com    12345678    12345678
    Solicitar o cadastro
    A mensagem exibida deve ser    Nome obrigatório

CT03 - Deve validar e-mail inválido (R2 = N)
    Preencher cadastro    João Silva    joaoemail.com    12345678    12345678
    Solicitar o cadastro
    A mensagem exibida deve ser    Email inválido

CT04 - Deve validar senha curta (R3 = N)
    Preencher cadastro    João Silva    joao@email.com    123    123
    Solicitar o cadastro
    A mensagem exibida deve ser    Senha inválida

CT05 - Deve validar divergência entre senhas (R4 = N)
    Preencher cadastro    João Silva    joao@email.com    12345678    87654321
    Solicitar o cadastro
    A mensagem exibida deve ser    Senhas diferentes

*** Keywords ***
Abrir o navegador na tela de cadastro
    Open Browser    ${URL}    ${BROWSER}    options=${OPCOES}

Preencher cadastro
    [Arguments]    ${nome}    ${email}    ${senha}    ${confirmar}
    Reload Page
    Wait Until Element Is Visible    ${INPUT_NOME}    timeout=5s
    Input Text        ${INPUT_NOME}         ${nome}
    Input Text        ${INPUT_EMAIL}        ${email}
    Input Password    ${INPUT_SENHA}        ${senha}
    Input Password    ${INPUT_CONFIRMAR}    ${confirmar}

Solicitar o cadastro
    Click Element    ${BOTAO_CADASTRAR}

A mensagem exibida deve ser
    [Arguments]    ${esperado}
    Wait Until Element Contains    ${MENSAGEM}    ${esperado}    timeout=5s
    Capture Page Screenshot

Fechar o navegador
    Close Browser
