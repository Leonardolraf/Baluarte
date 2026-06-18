*** Settings ***
Documentation     Teste automatizado de interface web — Criar Campanha de Phishing (Baluarte).
...               Técnica de modelagem: Partição de Equivalência sobre o destinatário
...               (interno / externo / formato inválido), o template e o nome da campanha.
Library           SeleniumLibrary
Suite Setup       Abrir o navegador na tela de campanha
Suite Teardown    Fechar o navegador

*** Variables ***
${URL}                 http://localhost:3000/campanha
${BROWSER}             chrome
${OPCOES}              add_argument("--headless=new"); add_argument("--no-sandbox"); add_argument("--disable-dev-shm-usage"); add_argument("--window-size=1280,900")
${INPUT_NOME}          id=nomeCampanha
${INPUT_DESTINATARIO}  id=destinatario
${SELECT_TEMPLATE}     id=template
${BOTAO_CRIAR}         id=btnCriar
${MENSAGEM}            id=mensagem

*** Test Cases ***
CT01 - Deve criar campanha com destinatário interno (CE1 válida)
    Preencher campanha    Phishing Q2    colaborador@empresa.com    urgencia
    Solicitar a criação
    A mensagem exibida deve ser    Campanha criada com sucesso

CT02 - Deve bloquear destinatário externo (CE2)
    Preencher campanha    Phishing Q2    colaborador@gmail.com    urgencia
    Solicitar a criação
    A mensagem exibida deve ser    Destinatário não autorizado: apenas e-mails internos

CT03 - Deve validar formato de e-mail (CE3)
    Preencher campanha    Phishing Q2    emailinvalido    urgencia
    Solicitar a criação
    A mensagem exibida deve ser    Formato de e-mail inválido

CT04 - Deve exigir template (CE4)
    Preencher campanha    Phishing Q2    colaborador@empresa.com    ${EMPTY}
    Solicitar a criação
    A mensagem exibida deve ser    Template é obrigatório

CT05 - Deve exigir nome da campanha (CE5)
    Preencher campanha    ${EMPTY}    colaborador@empresa.com    urgencia
    Solicitar a criação
    A mensagem exibida deve ser    Nome da campanha é obrigatório

*** Keywords ***
Abrir o navegador na tela de campanha
    Open Browser    ${URL}    ${BROWSER}    options=${OPCOES}

Preencher campanha
    [Arguments]    ${nome}    ${destinatario}    ${template}
    Reload Page
    Wait Until Element Is Visible    ${INPUT_NOME}    timeout=5s
    Input Text    ${INPUT_NOME}            ${nome}
    Input Text    ${INPUT_DESTINATARIO}    ${destinatario}
    IF    '${template}' != ''
        Select From List By Value    ${SELECT_TEMPLATE}    ${template}
    END

Solicitar a criação
    Click Element    ${BOTAO_CRIAR}

A mensagem exibida deve ser
    [Arguments]    ${esperado}
    Wait Until Element Contains    ${MENSAGEM}    ${esperado}    timeout=5s
    Capture Page Screenshot

Fechar o navegador
    Close Browser
