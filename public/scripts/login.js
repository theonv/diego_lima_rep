document.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const email = document.getElementById('email').value;
    const pass = document.getElementById('password').value;

    try {
        const response = await fetch('/api/enrollment/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, pass })
        });

        const data = await response.json();

        if (response.ok) {
            // ✅ Salva o nome para usar no "Olá, [Nome]" da próxima página
            localStorage.setItem('nomeAluno', data.userName);
            window.location.href = "/videoaulas";
        } else {
            alert(data.error);
        }

    } catch (error) {
        alert("Erro de conexão com o servidor.");
    }
});
