import 'dotenv/config';
import express from "express";
import cors from "cors";
import path from 'path';
import { fileURLToPath } from 'url';
import enrollmentRoutes from "./src/routes/enrollmentRoutes.js";

const __filename = fileURLToPath(import.meta.url);
// Este arquivo está em: api/server.js
const __dirname = path.dirname(__filename);


const app = express();

app.use(cors());
app.use(express.json());



// --- ARQUIVOS ESTÁTICOS ---
// Caminhos corretos partindo de api/server.js
app.use('/styles', express.static(path.join(__dirname, '../src/styles')));
app.use('/scripts', express.static(path.join(__dirname, '../src/scripts')));
app.use('/images', express.static(path.join(__dirname, '../public/imagens')));
app.use('/public', express.static(path.join(__dirname, '../public')));

//ROTA DA API - CADASTRO
app.use("/api/enrollment", enrollmentRoutes);


// --- ROTAS DE PÁGINAS ---
app.get('/', (req, res) => {
    // Caminho: api/server.js -> ../src/pages/lpg.html
    res.sendFile(path.join(__dirname, '../src/pages/lpg.html'));
});

app.get('/cadastro', (req, res) => {
    // Caminho: api/server.js -> ../src/pages/cadastro.html
    res.sendFile(path.join(__dirname, '../src/pages/cadastro.html'));
});


// --- ROTAS PRIVADAS / 404 ---
app.get('*', (req, res) => {
    res.status(404).send('<h1>Página não encontrada ou acesso restrito.</h1>');
});


// --- INICIALIZAÇÃO ---
const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta: ${PORT}`);
});