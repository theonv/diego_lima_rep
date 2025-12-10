function modulosReativos() {
    const headers = document.querySelectorAll(".header-mod");

    headers.forEach(header => {
        header.addEventListener("click", () => {
            const modulo = header.parentElement;
            modulo.classList.toggle("open");
        });
    });
}

document.addEventListener("DOMContentLoaded", () => {
    modulosReativos();
});
