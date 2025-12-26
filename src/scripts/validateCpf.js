// Validação de CPF (front-end)
// Disponibiliza a função global isValidCPF(cpf)

function cleanCPF(cpf) {
    return String(cpf).replace(/\D/g, '');
}

function isValidCPF(cpf) {
    if (!cpf) return false;
    const num = cleanCPF(cpf);
    if (num.length !== 11) return false;

    // Rejeita CPFs com todos os dígitos iguais (ex: 00000000000, 111...)
    if (/^(\d)\1{10}$/.test(num)) return false;

    // Cálculo do primeiro dígito verificador
    const calcDigit = (sliceLen) => {
        let sum = 0;
        for (let i = 0; i < sliceLen; i++) {
            sum += Number(num.charAt(i)) * (sliceLen + 1 - i);
        }
        const mod = (sum * 10) % 11;
        return mod === 10 ? 0 : mod;
    };

    const d1 = calcDigit(9);
    const d2 = calcDigit(10);

    return d1 === Number(num.charAt(9)) && d2 === Number(num.charAt(10));
}

// Expor no escopo global para uso em scripts não-modulares
window.isValidCPF = isValidCPF;

// Função utilitária para formatar CPF (000.000.000-00)
window.formatCPF = function (value) {
    const v = cleanCPF(value).slice(0, 11);
    return v.replace(/(\d{3})(\d{3})(\d{3})(\d{0,2})/, function (_, a, b, c, d) {
        return a + (b ? '.' + b : '') + (c ? '.' + c : '') + (d ? '-' + d : '');
    });
};

