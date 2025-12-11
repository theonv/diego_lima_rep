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

export default async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    const { method, url } = req;

    // Route: POST /api/enrollment/register
    // Vercel rewrites /api/enrollment/register to /api/enrollment
    // So we check if it's a POST request.
    // However, since we are using a single file for multiple "routes" via rewrites,
    // we might need to check the original URL or just assume based on method if they are distinct enough.
    // In this case:
    // POST is always register
    // GET is always status check (with ID)

    if (method === 'POST') {
        return await createEnrollment(req, res);
    }

    if (method === 'GET') {
        // Extract ID from query or path
        // Since we rewrite /api/enrollment/status/:id -> /api/enrollment?id=:id (implicitly or explicitly)
        // Actually, Vercel rewrites pass query params.
        // But our rewrite rule was: { "source": "/api/enrollment/status/:id", "destination": "/api/enrollment" }
        // This means the ID won't be in req.query.id automatically unless we map it.
        // Let's fix the rewrite rule in vercel.json to:
        // { "source": "/api/enrollment/status/:id", "destination": "/api/enrollment?id=:id" }
        // OR we can parse it from req.url if Vercel preserves it.
        // Vercel functions receive the rewritten URL in req.url usually? No, they receive the destination.
        
        // Let's rely on query params. I will update vercel.json to map the ID to a query param.
        
        const { id } = req.query;
        if (id) {
            req.params = { id };
            return await checkPaymentStatus(req, res);
        }
        
        // Fallback if ID is not in query (maybe direct call?)
        // If the rewrite didn't work as expected, we might need to parse req.url
    }

    res.status(404).json({ error: 'Not found' });
}

async function createEnrollment(req, res) {
    try {
        console.log("🚀 [createEnrollment] Iniciando processamento...");
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
            console.log(`🔄 [createEnrollment] Aluno encontrado (ID: ${alunoExistente.id}).`);

            // Impedir sobrescrição de um PAID
            if (alunoExistente.status === 'PAID') {
                console.warn('⚠️ [createEnrollment] Tentativa de criação/atualização para usuário já PAID.');
                return res.status(409).json({ error: 'Usuário já possui inscrição paga.' });
            }

            // Se estiver PENDING e já tiver paymentId, verificar o estado no Mercado Pago
            if (alunoExistente.status === 'PENDING' && alunoExistente.paymentId) {
                try {
                    const payment = new Payment(client);
                    const existingMp = await payment.get({ id: alunoExistente.paymentId });
                    const mpStatus = existingMp.status;
                    console.log(`🔎 [createEnrollment] Status MP do paymentId ${alunoExistente.paymentId}:`, mpStatus);

                    if (mpStatus === 'approved') {
                        await prisma.enrollment.update({ where: { id: alunoExistente.id }, data: { status: 'PAID' } });
                        return res.status(200).json({ resume: false, message: 'Pagamento já aprovado.', status: 'approved' });
                    }

                    const resumableStates = ['pending', 'in_process', 'processing', 'pending_waiting_transfer'];
                    if (resumableStates.includes(mpStatus)) {
                        // Se o usuário solicitou mudança de modalidade, permitimos criar novo pagamento
                        if (alunoExistente.modality && alunoExistente.modality !== modality) {
                            console.log(`🔁 [createEnrollment] Usuário pediu mudança de modalidade (${alunoExistente.modality} -> ${modality}). Criando novo pagamento.`);
                            try {
                                await prisma.enrollment.update({ where: { id: alunoExistente.id }, data: { status: 'REJECTED' } });
                                console.log('✅ [createEnrollment] Pagamento anterior marcado como REJECTED para permitir nova tentativa.');
                            } catch (err) {
                                console.error('❌ [createEnrollment] Erro ao marcar REJECTED no DB:', err.message);
                            }
                            // prosseguir criando novo pagamento abaixo
                        } else {
                            return res.status(200).json({
                                resume: true,
                                paymentId: alunoExistente.paymentId,
                                status: mpStatus,
                                valor: alunoExistente.amount,
                                modalidadeAnterior: alunoExistente.modality,
                                payment: {
                                    qrCodeBase64: existingMp.point_of_interaction?.transaction_data?.qr_code_base64,
                                    qrCodeCopyPaste: existingMp.point_of_interaction?.transaction_data?.qr_code,
                                }
                            });
                        }
                    }

                    if (mpStatus === 'rejected' || mpStatus === 'cancelled' || mpStatus === 'refunded') {
                        console.log(`⚠️ [createEnrollment] Pagamento anterior (${alunoExistente.paymentId}) com status ${mpStatus}. Marcando como REJECTED.`);
                        await prisma.enrollment.update({ where: { id: alunoExistente.id }, data: { status: 'REJECTED' } });
                        // prosseguir criando novo pagamento abaixo
                    }

                } catch (err) {
                    console.error('❌ [createEnrollment] Erro ao consultar MP para paymentId existente:', err.message);
                    // Em caso de erro ao consultar MP, prosseguir com a criação/atualização normalmente
                }
            }

            // Atualiza (ou re-tenta) criando um novo registro de tentativa
            console.log('🔄 [createEnrollment] Atualizando dados do aluno para nova tentativa...');
            const updated = await prisma.enrollment.update({ where: { id: alunoExistente.id }, data: alunoData });
            alunoId = updated.id;
            console.log('✅ [createEnrollment] Aluno atualizado com sucesso.');

        } else {
            console.log('✨ [createEnrollment] Aluno não encontrado. Criando novo registro...');
            const created = await prisma.enrollment.create({ data: alunoData });
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

        if (paymentMethod === 'cartao') {
            // Validação simples de 'installments' (deve ser inteiro entre 1 e 12)
            const parcelas = Number(installments) || 1;
            if (!Number.isInteger(parcelas) || parcelas < 1 || parcelas > 12) {
                console.warn('⚠️ [createEnrollment] installments inválido:', installments);
                return res.status(400).json({ error: 'Parâmetro installments inválido. Deve ser inteiro entre 1 e 12.' });
            }

            paymentData.token = token;
            paymentData.installments = parcelas;
            paymentData.payment_method_id = paymentMethodId;
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

        if (mpResponse.status === 'rejected') {
            console.warn("⚠️ [createEnrollment] Pagamento rejeitado.");
            try {
                await prisma.enrollment.update({ where: { id: alunoId }, data: { status: 'REJECTED' } });
            } catch (err) {
                console.error('❌ [createEnrollment] Erro ao marcar REJECTED no DB:', err.message);
            }
            return res.status(400).json({ error: "Pagamento rejeitado pelo banco. Verifique os dados ou limite." });
        }

        res.status(201).json({
            success: true,
            paymentId: mpResponse.id.toString(),
            status: mpResponse.status,
            valor: valorCobrado,
            payment: {
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
}

async function checkPaymentStatus(req, res) {
    try {
        const { id } = req.params;

        const payment = new Payment(client);
        const paymentInfo = await payment.get({ id: id });
        const status = paymentInfo.status;

        if (status === 'approved') {
            console.log("💰 Pagamento Aprovado! ID:", id);
        }

        if (status !== 'approved') {
            return res.json({ status: status });
        }

        const existingPayment = await prisma.enrollment.findFirst({
            where: { paymentId: id }
        });

        if (existingPayment && existingPayment.status === 'PAID') {
            return res.json({ status: status, message: "Pagamento já processado." }); 
        }

        if (existingPayment) {
            console.log("✅ Confirmando pagamento para aluno:", existingPayment.email);
            await prisma.enrollment.update({
                where: { id: existingPayment.id },
                data: { status: 'PAID' }
            });
        } else {
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
        console.error("❌ ERRO NO BACKEND:", error.message);
        res.status(500).json({ error: "Erro ao processar matrícula", details: error.message });
    }
}
