// ==================== Scroll Animation ====================
// 스크롤할 때 서비스 카드가 한 번에 다 나타나는 것이 아니라
// 스크롤되는 순간에 fadeInUp 애니메이션을 트리거함
document.addEventListener('DOMContentLoaded', function() {
    const cards = document.querySelectorAll('.service-card');

    if (typeof IntersectionObserver !== 'function') {
        return;
    }

    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };

    const observer = new IntersectionObserver(function(entries) {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                // 화면에 보이면 fade-in 클래스 추가 (CSS에서 애니메이션 정의)
                entry.target.classList.add('fade-in');
                observer.unobserve(entry.target);
            }
        });
    }, observerOptions);

    cards.forEach(card => {
        observer.observe(card);
    });
});
