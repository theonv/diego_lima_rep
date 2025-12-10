import { PrismaClient } from "@prisma/client";
import { MercadoPagoConfig, Payment } from 'mercadopago';

const prisma = new PrismaClient();

const client = new MercadoPagoConfig({
    accessToken: process.env.MP_ACCESS_TOKEN,
    options: { timeout: 5000 }
});

const DATA_FIM_PROMOCAO = new Date('2025-12-17T23:59:59-03:00'); // Horário de Brasília
const PRECOS = {
    TIER_1: { COM: 799.00, SEM: 599.00 }, // Primeiros 20 alunos
    TIER_2: { COM: 1000.00, SEM: 700.00 }, // Até 17/12
    TIER_3: { COM: 1920.00, SEM: 1520.00 } // Preço Normal
};

async function calcularPreco(modalidade) {
    const totalAlunosPagos = await prisma.enrollment.count({ where: { status: 'PAID' } });
    const agora = new Date();

    let valorFinal = 0;
    
    // 1. Prioridade: Primeiros 20 alunos PAGOS
    if (totalAlunosPagos < 20) {
        valorFinal = (modalidade === 'COM_MATERIAL') ? PRECOS.TIER_1.COM : PRECOS.TIER_1.SEM;
    } 
    // 2. Promoção por tempo (Até 17/12)
    else if (agora <= DATA_FIM_PROMOCAO) {
        valorFinal = (modalidade === 'COM_MATERIAL') ? PRECOS.TIER_2.COM : PRECOS.TIER_2.SEM;
    } 
    // 3. Preço Normal
    else {
        valorFinal = (modalidade === 'COM_MATERIAL') ? PRECOS.TIER_3.COM : PRECOS.TIER_3.SEM;
    }
    return valorFinal;
}

export const createEnrollment = async (req, res) => {
    try {
        console.log("🚀 [createEnrollment] Iniciando processamento...");
        // Recebemos 'paymentMethodId' (visa/master) e 'token' do frontend
        const { name, email, cpf, phone, modality, paymentMethod, installments, token, paymentMethodId } = req.body;
        
        console.log("📦 [createEnrollment] Body recebido:", JSON.stringify({ name, email, cpf, phone, modality, paymentMethod }, null, 2));

        if (!modality) {
            console.error("❌ [createEnrollment] Modalidade não fornecida.");
            return res.status(400).json({ error: "Modalidade inválida." });
        }

        const valorCobrado = await calcularPreco(modality);
        console.log("💰 [createEnrollment] Valor calculado:", valorCobrado);

        // 1. CRIA OU ATUALIZA O USUÁRIO NO BANCO COMO "PENDING" ANTES DO PAGAMENTO
        console.log("📝 [createEnrollment] Preparando dados do aluno (PENDING)...");
        
        const cpfLimpo = cpf.replace(/\D/g, '');
        const alunoData = {
            name,
            email,
            cpf: cpfLimpo,
            phone,
            modality,
            amount: valorCobrado,
            status: 'PENDING'
        };
        console.log("👤 [createEnrollment] Dados do aluno para DB:", alunoData);

        // Verifica se já existe
        console.log("🔍 [createEnrollment] Buscando aluno existente por Email ou CPF...");
        const alunoExistente = await prisma.enrollment.findFirst({
            where: { OR: [{ email: email }, { cpf: cpfLimpo }] }
        });

        let alunoId;

        if (alunoExistente) {
            console.log(`🔄 [createEnrollment] Aluno encontrado (ID: ${alunoExistente.id}). Atualizando...`);
            // Se já existe (mesmo que PAID), atualizamos os dados para a nova tentativa
            // (Se for PAID, o usuário está comprando de novo? Assumimos que sim)
            const updated = await prisma.enrollment.update({
                where: { id: alunoExistente.id },
                data: alunoData
            });
            alunoId = updated.id;
            console.log("✅ [createEnrollment] Aluno atualizado com sucesso.");
        } else {
            console.log("✨ [createEnrollment] Aluno não encontrado. Criando novo registro...");
            const created = await prisma.enrollment.create({
                data: alunoData
            });
            alunoId = created.id;
            console.log(`✅ [createEnrollment] Aluno criado com sucesso. ID: ${alunoId}`);
        }

        // 2. GERA O PAGAMENTO NO MERCADO PAGO
        console.log("💳 [createEnrollment] Iniciando integração com Mercado Pago...");
        const payment = new Payment(client);

        let paymentData = {
            transaction_amount: valorCobrado,
            description: `Curso Matemática - ${modality}`,
            payer: {
                email: email,
                first_name: name.split(" ")[0],
                identification: { type: 'CPF', number: cpfLimpo }
            },
            metadata: { name, email, cpf: cpfLimpo, phone, modality, alunoId } // Passamos o ID do aluno no metadata
        };
        console.log("📤 [createEnrollment] Payload para Mercado Pago:", JSON.stringify(paymentData, null, 2));

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
        console.log("📥 [createEnrollment] Resposta do Mercado Pago:", mpResponse.status, mpResponse.id);

        // 3. ATUALIZA O USUÁRIO COM O ID DO PAGAMENTO
        console.log(`🔗 [createEnrollment] Vinculando PaymentID ${mpResponse.id} ao Aluno ${alunoId}...`);
        await prisma.enrollment.update({
            where: { id: alunoId },
            data: { paymentId: mpResponse.id.toString() }
        });
        console.log("✅ [createEnrollment] Vínculo concluído.");

        //cartão rejeitado
        if (mpResponse.status === 'rejected') {
            console.warn("⚠️ [createEnrollment] Pagamento rejeitado.");
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
        console.error("❌ [createEnrollment] ERRO FATAL:", error);
        if (error.response) {
             console.error("❌ [createEnrollment] Detalhes do erro MP:", JSON.stringify(error.response.data, null, 2));
        }
        res.status(500).json({ error: "Erro ao processar pagamento.", details: error.message });
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
        }
        // ----------------------------------------

        // 2. Se não for aprovado, encerra aqui
        if (status !== 'approved') {
            return res.json({ status: status });
        }

        // 3. Verifica se JÁ salvamos esse pagamento específico pelo ID
        // Como agora salvamos o paymentId na criação, buscamos por ele
        const existingPayment = await prisma.enrollment.findFirst({
            where: { paymentId: id }
        });

        if (existingPayment && existingPayment.status === 'PAID') {
            return res.json({ status: status, message: "Pagamento já processado." }); 
        }

        if (existingPayment) {
            // 4. ATUALIZA O STATUS PARA PAID
            console.log("✅ Confirmando pagamento para aluno:", existingPayment.email);
            await prisma.enrollment.update({
                where: { id: existingPayment.id },
                data: { status: 'PAID' }
            });
        } else {
            // Fallback: Se por algum motivo o registro não existir (ex: criado antes dessa mudança),
            // tentamos criar/atualizar usando o metadata como antes.
            console.warn("⚠️ Aluno não encontrado pelo PaymentID. Tentando recuperar via Metadata...");
            
            const userData = paymentInfo.metadata || {};
            const novoAluno = {
                name: userData.name || "Aluno Sem Nome",
                email: userData.email, 
                cpf: userData.cpf,
                phone: userData.phone || "",
                modality: userData.modality || "SEM_MATERIAL", 
                amount: paymentInfo.transaction_amount || 0,
                status: 'PAID',
                paymentId: id
            };

            const alunoExistente = await prisma.enrollment.findFirst({
                where: { OR: [{ email: novoAluno.email }, { cpf: novoAluno.cpf }] }
            });

            if (alunoExistente) {
                await prisma.enrollment.update({
                    where: { id: alunoExistente.id },
                    data: novoAluno
                });
            } else {
                await prisma.enrollment.create({
                    data: novoAluno
                });
            }
        }

        res.json({ status: status, message: "Matrícula confirmada!" });

    } catch (error) {
        // ESSE LOG VAI TE CONTAR A VERDADE NO TERMINAL
        console.error("❌ ERRO NO BACKEND:", error.message);
        if (error.code) console.error("Código do Erro Prisma:", error.code);
        
        res.status(500).json({ error: "Erro ao processar matrícula", details: error.message });
    }
};