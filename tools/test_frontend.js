const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

function fail(msg) { console.error('FAIL:', msg); process.exitCode = 1; }
function pass(msg) { console.log('PASS:', msg); }

const htmlPath = path.resolve(__dirname, '..', 'public', 'cadastro.html');
const validatePath = path.resolve(__dirname, '..', 'public', 'scripts', 'validateCpf.js');
const cadastroPath = path.resolve(__dirname, '..', 'public', 'scripts', 'cadastro.js');

const html = fs.readFileSync(htmlPath, 'utf8');
const validateJs = fs.readFileSync(validatePath, 'utf8');
const cadastroJs = fs.readFileSync(cadastroPath, 'utf8');

(async () => {
    const dom = new JSDOM(html, { runScripts: 'outside-only', resources: 'usable', url: 'http://localhost' });
    const { window } = dom;

    // Stubs
    window.MercadoPago = function () {
        return {
            getPaymentMethods: async () => ({ results: [] }),
            createCardToken: async () => ({ id: 'tok_test' })
        };
    };

    // Provide a minimal fetch implementation for cadastro.js network calls
    window.fetch = async function (url, opts) {
        // Return a fake successful response for the register endpoint
        return {
            ok: true,
            json: async () => ({ payment: { qrCodeBase64: '', qrCodeCopyPaste: 'abc' }, paymentId: 'pid', valor: 100 })
        };
    };

    // Evaluate validation and cadastro scripts in the window
    dom.runVMScript(new (require('vm').Script)(validateJs), { displayErrors: true });
    dom.runVMScript(new (require('vm').Script)(cadastroJs), { displayErrors: true });

    // Basic DOM queries
    const cpf = window.document.getElementById('cpf');
    const telefone = window.document.getElementById('telefone');
    const form = window.document.querySelector('.checkout-form');

    if (!cpf || !telefone || !form) {
        fail('Campos essenciais não encontrados no DOM');
        process.exit(1);
    }

    // Test CPF formatting and validation (valid CPF)
    cpf.value = '52998224725';
    cpf.dispatchEvent(new window.Event('input', { bubbles: true }));
    const formatted = cpf.value;
    if (formatted !== '529.982.247-25') {
        fail('Formatação de CPF inválida: got ' + formatted);
    } else pass('Formatação de CPF aplicou corretamente');

    if (!window.isValidCPF('529.982.247-25')) {
        fail('isValidCPF reportou inválido para CPF válido');
    } else pass('Validação isValidCPF reconheceu CPF válido');

    // Test invalid CPF blocks submission
    // Override enviarParaBackend to detect if called
    window.enviarChamado = false;
    window.enviarParaBackend = function () { window.enviarChamado = true; };

    // Set invalid CPF
    cpf.value = '12345678900';
    cpf.dispatchEvent(new window.Event('input', { bubbles: true }));

    // Simulate submit
    const submitEvent = new window.Event('submit', { bubbles: true, cancelable: true });
    form.dispatchEvent(submitEvent);

    if (window.enviarChamado) {
        fail('Formulário enviou com CPF inválido (enviarParaBackend foi chamado)');
    } else pass('Formulário bloqueado com CPF inválido');

    // Test telefone mask
    telefone.value = '11987654321';
    telefone.dispatchEvent(new window.Event('input', { bubbles: true }));
    if (telefone.value !== '(11) 98765-4321') {
        fail('Máscara de telefone incorreta: got ' + telefone.value);
    } else pass('Máscara de telefone aplicou corretamente');

    if (process.exitCode === 1) process.exit(1);
    console.log('\nTodos os testes executados.');
})();
