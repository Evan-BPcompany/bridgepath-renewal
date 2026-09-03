// ==================== Scroll Animation ====================
// 스크롤할 때 서비스 카드가 한 번에 다 나타나는 것이 아니라
// 스크롤되는 순간에 fadeInUp 애니메이션을 트리거함
document.addEventListener('DOMContentLoaded', function() {
    const cards = document.querySelectorAll('.service-card');

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

// ==================== Form Submission ====================
// 폼 제출 핸들러
document.getElementById('estimateForm').addEventListener('submit', function(e) {
    e.preventDefault(); // 기본 폼 제출 방지

    // 폼 데이터 수집 (현재는 검증만 함)
    const formData = {
        productType: document.getElementById('productType').value,
        quantity: document.getElementById('quantity').value,
        companyName: document.getElementById('companyName').value,
        contactPerson: document.getElementById('contactPerson').value,
        email: document.getElementById('email').value,
        phone: document.getElementById('phone').value,
        message: document.getElementById('message').value
    };

    // 간단한 검증
    if (!formData.productType || !formData.quantity || !formData.companyName || !formData.email) {
        alert('필수 항목을 모두 입력해주세요.');
        return;
    }

    // 이메일 형식 간단 검증
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email)) {
        alert('올바른 이메일 형식을 입력해주세요.');
        return;
    }

    // 폼 숨김, 성공 메시지 표시
    document.getElementById('estimateForm').style.display = 'none';
    document.getElementById('successMessage').style.display = 'block';

    // 5초 후 폼 다시 보이게 함 (또는 페이지 새로고침 가능)
    setTimeout(function() {
        document.getElementById('estimateForm').style.display = 'block';
        document.getElementById('successMessage').style.display = 'none';
        document.getElementById('estimateForm').reset(); // 폼 초기화
    }, 3000);
});

