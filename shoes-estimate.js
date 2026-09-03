// ==================== Form Submission ====================
document.addEventListener('DOMContentLoaded', function() {
    const submitBtn = document.getElementById('submitBtn');

    if (submitBtn) {
        submitBtn.addEventListener('click', function() {
            // 필수 입력 검증
            const quantity = document.getElementById('quantity').value;
            const sizes = document.querySelectorAll('input[name="size"]:checked').length;

            if (!quantity) {
                alert('수량을 입력해주세요.');
                return;
            }

            if (sizes === 0) {
                alert('최소 1개 이상의 사이즈를 선택해주세요.');
                return;
            }

            // 폼 데이터 수집
            const formData = {
                category: selectedCategory,
                material: document.getElementById('material').value,
                color: document.getElementById('color').value,
                sizes: Array.from(document.querySelectorAll('input[name="size"]:checked')).map(s => s.value),
                quantity: quantity,
                deliveryDate: document.getElementById('deliveryDate').value,
                additionalInfo: document.getElementById('additionalInfo').value
            };

            // 콘솔에 로그 (나중에 서버로 전송)
            console.log('신발 견적 요청:', formData);

            // 성공 메시지 표시
            const formSection = document.querySelector('.form-section');
            const formButtons = document.querySelector('.form-buttons');
            formSection.style.display = 'none';
            formButtons.style.display = 'none';
            document.getElementById('successMessage').style.display = 'block';

            // 3초 후 메인 페이지로 이동
            setTimeout(function() {
                window.location.href = 'index.html';
            }, 3000);
        });
    }
});
