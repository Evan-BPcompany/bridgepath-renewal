// ==================== Form Submission ====================
document.addEventListener('DOMContentLoaded', function() {
    const submitBtn = document.getElementById('submitBtn');

    if (submitBtn) {
        submitBtn.addEventListener('click', function() {
            // 필수 입력 검증
            const quantity = document.getElementById('quantity').value;

            if (!quantity) {
                alert('수량을 입력해주세요.');
                return;
            }

            if (quantity < 1) {
                alert('수량은 1개 이상이어야 합니다.');
                return;
            }

            // 폼 데이터 수집
            const formData = {
                category: selectedCategory,
                frameColor: document.getElementById('frameColor').value,
                lensType: document.getElementById('lensType').value,
                frameMaterial: document.getElementById('frameMaterial').value,
                lensColor: document.getElementById('lensColor').value,
                bridgeWidth: document.getElementById('bridgeWidth').value,
                armLength: document.getElementById('armLength').value,
                lensWidth: document.getElementById('lensWidth').value,
                quantity: quantity,
                deliveryDate: document.getElementById('deliveryDate').value,
                additionalInfo: document.getElementById('additionalInfo').value
            };

            // 콘솔에 로그 (나중에 서버로 전송)
            console.log('선글라스 견적 요청:', formData);

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
