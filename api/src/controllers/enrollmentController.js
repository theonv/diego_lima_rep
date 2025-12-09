import { PrismaClient } from "@prisma/client";
import { MercadoPagoConfig, Payment } from 'mercadopago';

const prisma = new PrismaClient();

const client = new MercadoPagoConfig({
    accessToken: process.env.MP_ACCESS_TOKEN,
    options: { timeout: 5000 }
});

const DATA_LANCAMENTO = new Date('2025-12-05T00:00:00');
const PRECOS = {
    TIER_1: { COM: 799.00, SEM: 599.00 },
    TIER_2: { COM: 1000.00, SEM: 700.00 },
    TIER_3: { COM: 1920.00, SEM: 1520.00 }
};

async function calcularPreco(modalidade) {
    const totalAlunosPagos = await prisma.enrollment.count({ where: { status: 'PAID' } });
    const agora = new Date();
    const diasDesdeLancamento = (agora - DATA_LANCAMENTO) / (1000 * 60 * 60 * 24);

    let valorFinal = 0;
    if (totalAlunosPagos < 20) {
        valorFinal = (modalidade === 'COM_MATERIAL') ? PRECOS.TIER_1.COM : PRECOS.TIER_1.SEM;
    } else if (diasDesdeLancamento <= 7) {
        valorFinal = (modalidade === 'COM_MATERIAL') ? PRECOS.TIER_2.COM : PRECOS.TIER_2.SEM;
    } else {
        valorFinal = (modalidade === 'COM_MATERIAL') ? PRECOS.TIER_3.COM : PRECOS.TIER_3.SEM;
    }
    return valorFinal;
}

export const createEnrollment = async (req, res) => {
    try {
        // Recebemos 'paymentMethodId' (visa/master) e 'token' do frontend
        const { name, email, cpf, phone, modality, paymentMethod, installments, token, paymentMethodId } = req.body;

        if (!modality) return res.status(400).json({ error: "Modalidade inválida." });

        const valorCobrado = await calcularPreco(modality);
        const payment = new Payment(client);

        let paymentData = {
            transaction_amount: valorCobrado,
            description: `Curso Matemática - ${modality}`,
            payer: {
                email: email,
                first_name: name.split(" ")[0],
                identification: { type: 'CPF', number: cpf.replace(/\D/g, '') }
            },
            metadata: { name, email, cpf, phone, modality }
        };

        // --- SELEÇÃO DO MÉTODO ---
        if (paymentMethod === 'cartao') {
            paymentData.token = token; // Token seguro
            paymentData.installments = installments; // 1 a 12
            paymentData.payment_method_id = paymentMethodId; // 'visa', 'master', etc. (Vem do Front)
            
        } else if (paymentMethod === 'boleto') {
            paymentData.payment_method_id = 'bolbradesco';
        } else {
            paymentData.payment_method_id = 'pix';
        }

        const mpResponse = await payment.create({ body: paymentData });

        //cartão rejeitado
        if (mpResponse.status === 'rejected') {
            return res.status(400).json({ error: "Pagamento rejeitado pelo banco. Verifique os dados ou limite." });
        }

        res.status(201).json({
            success: true,
            paymentId: mpResponse.id.toString(),
            status: mpResponse.status,
            valor: valorCobrado,
            payment: {
                // Dados para PIX
                qrCodeBase64: mpResponse.point_of_interaction?.transaction_data?.qr_code_base64,
                qrCodeCopyPaste: mpResponse.point_of_interaction?.transaction_data?.qr_code,
            }
        });

    } catch (error) {
        console.error("Erro MP:", error);
        res.status(500).json({ error: "Erro ao processar pagamento." });
    }
};

export const checkPaymentStatus = async (req, res) => {
    try {
        const { id } = req.params;

        // 1. Consulta o Mercado Pago
        const payment = new Payment(client);
        const paymentInfo = await payment.get({ id: id });
        const status = paymentInfo.status;

        // --- ÁREA DE DEBUG (OLHE O TERMINAL APÓS PAGAR!) ---
        if (status === 'approved') {
            console.log("💰 Pagamento Aprovado! ID:", id);
            console.log("📦 Metadados recebidos:", JSON.stringify(paymentInfo.metadata, null, 2));
            
            if (!paymentInfo.metadata) {
                console.error("❌ ERRO CRÍTICO: Mercado Pago não retornou os dados do aluno (metadata).");
                // Tenta prosseguir, mas vai dar erro se faltar dados obrigatórios
            }
        }
        // ----------------------------------------

        // 2. Se não for aprovado, encerra aqui
        if (status !== 'approved') {
            return res.json({ status: status });
        }

        // 3. Verifica se JÁ salvamos esse pagamento específico pelo ID
        const existingPayment = await prisma.enrollment.findFirst({
            where: { paymentId: id }
        });

        if (existingPayment) {
            return res.json({ status: status, message: "Pagamento já processado." }); 
        }

        // 4. Recupera dados e TENTA salvar
        const userData = paymentInfo.metadata || {};

        // Proteção: Cria o objeto com valores padrão para evitar que o servidor caia
        const novoAluno = {
            name: userData.name || userData.Name || "Aluno Sem Nome",
            email: userData.email, 
            cpf: userData.cpf,
            phone: userData.phone || "",
            modality: userData.modality || "SEM_MATERIAL", 
            amount: paymentInfo.transaction_amount || 0,
            status: 'PAID',
            paymentId: id
        };

        console.log("📝 Tentando processar aluno:", novoAluno.email);

        // 5. LÓGICA INTELIGENTE: Verifica duplicidade de Email/CPF antes de criar
        // Isso impede o erro 500 se o usuário tentou pagar 2 vezes
        const alunoExistente = await prisma.enrollment.findFirst({
            where: { OR: [{ email: novoAluno.email }, { cpf: novoAluno.cpf }] }
        });

        if (alunoExistente) {
            console.log("🔄 Usuário já existia. Atualizando registro...");
            await prisma.enrollment.update({
                where: { id: alunoExistente.id },
                data: novoAluno
            });
        } else {
            console.log("✨ Criando novo registro no banco...");
            await prisma.enrollment.create({
                data: novoAluno
            });
        }

        res.json({ status: status, message: "Matrícula confirmada!" });

    } catch (error) {
        // ESSE LOG VAI TE CONTAR A VERDADE NO TERMINAL
        console.error("❌ ERRO NO BACKEND:", error.message);
        if (error.code) console.error("Código do Erro Prisma:", error.code);
        
        res.status(500).json({ error: "Erro ao processar matrícula", details: error.message });
    }
};