// Arquivo: src/scripts/cadastro.js

// --- CONFIGURAÇÃO INICIAL ---
// PUBLIC KEY DE PRODUÇÃO (Começa com "APP_USR-")
const mp = new MercadoPago('APP_USR-f2069842-413b-44c0-89c4-9ede49a0e6c1');

// Lógica para definir a URL da API automaticamente
// No Vercel (Prod ou Dev), a API está no mesmo domínio/porta
const API_BASE_URL = ''; 
// Se precisar rodar o backend separado localmente (ex: node server.js na porta 4000), descomente abaixo:
// const API_BASE_URL = 'http://localhost:4000';

let paymentMethodId = '';
let intervaloVerificacao = null;

// 1. MÁSCARAS DE INPUT (FORMATACAO AUTOMÁTICA)

// (Adiciona a / automaticamente na data)
document.getElementById('cardExpiration').addEventListener('input', function (e) {
    let input = e.target.value.replace(/\D/g, ''); // Remove letras
    if (input.length > 2) {
        input = input.substring(0, 2) + '/' + input.substring(2, 4);
    }
    e.target.value = input;
});

// (Adiciona espaço a cada 4 dígitos do N do cartão)
document.getElementById('cardNumber').addEventListener('input', function (e) {
    let input = e.target.value.replace(/\D/g, ''); // Remove letras
    input = input.substring(0, 16); // Limita a 16 números
    if (input.length > 0) {
        input = input.match(/.{1,4}/g).join(' '); // Espaço a cada 4
    }
    e.target.value = input;
});

// --- MÁSCARA CPF (em tempo real) ---
const cpfField = document.getElementById('cpf');
if (cpfField) {
    cpfField.addEventListener('input', function (e) {
        const raw = e.target.value.replace(/\D/g, '');
        e.target.value = (typeof window.formatCPF === 'function') ? window.formatCPF(raw) : raw;
    });
}

// --- MÁSCARA TELEFONE (em tempo real) ---
const phoneField = document.getElementById('telefone');
if (phoneField) {
    phoneField.addEventListener('input', function (e) {
        let v = e.target.value.replace(/\D/g, '').slice(0, 11); // até 11 dígitos (DD + 9)
        if (v.length <= 2) {
            e.target.value = v;
            return;
        }

        const ddd = v.slice(0, 2);
        const rest = v.slice(2);

        if (rest.length <= 4) {
            e.target.value = `(${ddd}) ${rest}`;
        } else if (rest.length <= 7) {
            e.target.value = `(${ddd}) ${rest.slice(0, rest.length - 4)}-${rest.slice(-4)}`;
        } else { // 9 dígitos no corpo
            e.target.value = `(${ddd}) ${rest.slice(0, 5)}-${rest.slice(5)}`;
        }
    });
}

// --- 2. DETECTAR BANDEIRA DO CARTÃO ---
document.getElementById('cardNumber').addEventListener('keyup', async (event) => {
    // Remove os espaços visuais para enviar o número limpo para a API
    const cardNumber = event.target.value.replace(/\s/g, '');

    if (cardNumber.length >= 6 && !paymentMethodId) {
        const bin = cardNumber.substring(0, 6);
        try {
            const paymentMethods = await mp.getPaymentMethods({ bin: bin });
            if (paymentMethods.results.length > 0) {
                paymentMethodId = paymentMethods.results[0].id; // ex: "visa", "master"
                console.log("Bandeira detectada:", paymentMethodId);
            }
        } catch (error) {
            console.error("Erro ao detectar bandeira", error);
        }
    }
    if (cardNumber.length < 6) paymentMethodId = '';
});

// 3. CONTROLE DE VISIBILIDADE (CARTÃO/PIX)
document.getElementById('pagamento').addEventListener('change', function () {
    const formaPagamento = this.value;
    const cardFields = document.getElementById('card-fields');

    if (formaPagamento === 'cartao') {
        cardFields.style.display = 'block';
    } else {
        cardFields.style.display = 'none';
    }
});

// 4. CONTROLE DOS TERMOS (Reseta se desmarcar)
document.getElementById('termos').addEventListener('change', function () {
    if (!this.checked) {
        if (intervaloVerificacao) clearInterval(intervaloVerificacao);
        const qrBox = document.querySelector('.qr-placeholder');
        qrBox.innerHTML = '<p>O QR Code aparecerá aqui após gerar o pagamento.</p>';
        qrBox.style.opacity = '0.7';
        qrBox.style.border = '2px dashed var(--color-lime-green)';
    }
});

// 5. SUBMISSÃO DO FORMULÁRIO
document.querySelector('.checkout-form').addEventListener('submit', async (event) => {
    event.preventDefault();

    // --- VALIDAÇÃO DE CPF (front-end) ---
    const cpfInput = document.getElementById('cpf');
    const cpfValue = cpfInput.value || '';
    // Se a função isValidCPF estiver disponível (foi adicionada em validateCpf.js), use-a
    if (typeof window.isValidCPF === 'function') {
        if (!window.isValidCPF(cpfValue)) {
            alert('CPF inválido. Verifique o número e tente novamente.');
            cpfInput.focus();
            return;
        }
    }

    // Formata visualmente o CPF (opcional)
    if (typeof window.formatCPF === 'function') {
        cpfInput.value = window.formatCPF(cpfValue);
    }

    const termosAceitos = document.getElementById('termos').checked;
    if (!termosAceitos) {
        alert("Você precisa ler e aceitar os Termos de Uso e Contrato para continuar.");
        return;
    }

    // Captura dados básicos
    const dadosBasicos = {
        name: document.getElementById('nome').value,
        email: document.getElementById('email').value,
        phone: document.getElementById('telefone').value,
        cpf: document.getElementById('cpf').value,
        modality: document.getElementById('modalidade').value,
        paymentMethod: document.getElementById('pagamento').value
    };

    if (!dadosBasicos.modality) return alert("Selecione a modalidade!");

    // Limpa intervalo anterior se existir
    if (intervaloVerificacao) clearInterval(intervaloVerificacao);

    // --- LÓGICA DO CARTÃO DE CRÉDITO ---
    if (dadosBasicos.paymentMethod === 'cartao') {
        if (!paymentMethodId) return alert("Número de cartão inválido ou bandeira não detectada.");

        try {
            const expiracao = document.getElementById('cardExpiration').value;

            // Valida formato da data antes de tentar processar
            if (!expiracao.includes('/') || expiracao.length !== 5) {
                alert("Data de validade inválida. Digite todos os números.");
                return;
            }

            const cardData = {
                cardNumber: document.getElementById('cardNumber').value.replace(/\s/g, ''), // Tira espaços
                cardholderName: document.getElementById('cardholderName').value,
                cardExpirationMonth: expiracao.split('/')[0],
                cardExpirationYear: '20' + expiracao.split('/')[1], // Assume ano 20xx
                securityCode: document.getElementById('securityCode').value,
                identification: {
                    type: 'CPF',
                    number: dadosBasicos.cpf.replace(/\D/g, '') // Apenas números do CPF
                }
            };

            // GERA O TOKEN SEGURO COM O MERCADO PAGO
            const tokenResponse = await mp.createCardToken(cardData);

            // Anexa dados de pagamento ao objeto de envio
            dadosBasicos.token = tokenResponse.id;
            dadosBasicos.installments = Number(document.getElementById('parcelas').value);
            dadosBasicos.paymentMethodId = paymentMethodId;

            enviarParaBackend(dadosBasicos);

        } catch (error) {
            console.error("Erro no cartão:", error);
            // Mensagem amigável para o usuário
            const msg = error.message || "Verifique número, validade e CVV.";
            alert("Não foi possível processar o cartão: " + msg);
        }
    }
    // --- LÓGICA DO PIX / BOLETO ---
    else {
        dadosBasicos.installments = 1;
        enviarParaBackend(dadosBasicos);
    }
});

// FUNÇÃO DE ENVIO PARA O SERVIDOR
async function enviarParaBackend(payload) {
    try {
            // Usa a URL base definida no topo
        const response = await fetch(`${API_BASE_URL}/api/enrollment/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        
        console.log(response)

        const resultado = await response.json();

        console.log("criou oau")

        if (response.ok) {
            if (payload.paymentMethod === 'pix') {
                mostrarPix(resultado);

            } else if (payload.paymentMethod === 'cartao') {
                alert("Pagamento Aprovado com Sucesso! Bem-vindo(a) ao curso.");
                window.location.href = "/";
            }

        } else {
            // Mostra o erro que veio do backend (ex: Saldo insuficiente)
            alert('Erro: ' + (resultado.error || 'Erro desconhecido'));
        }

    } catch (error) {
        console.error(error);
        alert('Erro de conexão com o servidor.');
    }
}

function mostrarPix(resultado) {
    const { qrCodeBase64, qrCodeCopyPaste } = resultado.payment;
    const { paymentId, valor } = resultado;
    const qrBox = document.querySelector('.qr-placeholder');

    qrBox.innerHTML = `
        <div style="text-align: center; gap: 15px; display: flex; flex-direction: column; align-items: center;">
            <h4 style="color: #fff;">Valor: <strong style="color: #39ff14;">R$ ${valor.toFixed(2)}</strong></h4>
            <p style="color:#39ff14; font-weight:bold;">Escaneie o QR Code:</p>
            <img src="data:image/png;base64,${qrCodeBase64}" style="width:200px; border-radius:10px; border: 4px solid white;">
            <textarea readonly style="width:100%; margin-top:10px; background: #222; color: #fff; padding: 10px; border-radius: 5px;">${qrCodeCopyPaste}</textarea>
        </div>
    `;
    qrBox.style.opacity = "1";
    qrBox.style.border = "2px solid #39ff14";

    // Inicia verificação (polling)
    intervaloVerificacao = setInterval(async () => {
        // Usa a URL base para verificar status
        const check = await fetch(`${API_BASE_URL}/api/enrollment/status/${paymentId}`);
        const dadosCheck = await check.json();
        if (dadosCheck.status === 'approved') {
            clearInterval(intervaloVerificacao);
            alert("PAGAMENTO CONFIRMADO! Bem-vindo ao curso! Em breve entraremos em contato para liberar o acesso da plataforma de conteúdo.");
            window.location.href = "/";
        }
    }, 3000);
}


// --- LÓGICA DO MODAL DE CONTRATO ---
const modal = document.getElementById('modal-contrato');
const btnAbrir = document.getElementById('btn-abrir-contrato');
const btnFechar = document.querySelector('.btn-fechar-modal');
const spanFechar = document.querySelector('.close-modal');

// Abrir Modal
btnAbrir.addEventListener('click', (e) => {
    e.preventDefault(); // Impede o link de recarregar a página
    modal.style.display = 'flex'; // Mostra o modal (flex para centralizar)
});

// Fechar Modal (Botão Inferior)
btnFechar.addEventListener('click', () => {
    modal.style.display = 'none';
});

// Fechar Modal (X no canto)
spanFechar.addEventListener('click', () => {
    modal.style.display = 'none';
});

// Fechar se clicar fora da caixa (no fundo escuro)
window.addEventListener('click', (e) => {
    if (e.target == modal) {
        modal.style.display = 'none';
    }
});
