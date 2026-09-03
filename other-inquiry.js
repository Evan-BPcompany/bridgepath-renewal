// ==================== Image Upload ====================
document.addEventListener('DOMContentLoaded', function() {
    const imageUploadBox = document.getElementById('imageUploadBox');
    const imageInput = document.getElementById('productImage');

    // 클릭해서 파일 선택
    imageUploadBox.addEventListener('click', function() {
        imageInput.click();
    });

    // 파일 선택 후 처리
    imageInput.addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (file) {
            imageUploadBox.innerHTML = `
                <div class="upload-icon">✓</div>
                <p>${file.name}</p>
                <p style="font-size: 0.8rem; color: #999;">선택됨</p>
            `;
        }
    });

    // 드래그 앤 드롭
    imageUploadBox.addEventListener('dragover', function(e) {
        e.preventDefault();
        imageUploadBox.style.background = 'rgba(102, 126, 234, 0.15)';
    });

    imageUploadBox.addEventListener('dragleave', function() {
        imageUploadBox.style.background = 'rgba(102, 126, 234, 0.05)';
    });

    imageUploadBox.addEventListener('drop', function(e) {
        e.preventDefault();
        imageUploadBox.style.background = 'rgba(102, 126, 234, 0.05)';

        const files = e.dataTransfer.files;
        if (files.length > 0) {
            imageInput.files = files;
            const event = new Event('change', { bubbles: true });
            imageInput.dispatchEvent(event);
        }
    });

    // ==================== Form Submission ====================
    const inquiryForm = document.getElementById('inquiryForm');

    inquiryForm.addEventListener('submit', function(e) {
        e.preventDefault();

        // 필수 입력 검증
        const productDescription = document.getElementById('productDescription').value;
        const quantity = document.getElementById('quantity').value;

        if (!productDescription.trim()) {
            alert('제품 설명을 입력해주세요.');
            return;
        }

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
            productDescription: productDescription,
            quantity: quantity,
            deliveryDate: document.getElementById('deliveryDate').value,
            hasImage: imageInput.files.length > 0
        };

        // 콘솔에 로그 (나중에 서버로 전송)
        console.log('기타 맞춤형 제품 문의:', formData);

        // 성공 메시지 표시
        inquiryForm.style.display = 'none';
        document.getElementById('successMessage').style.display = 'block';

        // 3초 후 메인 페이지로 이동
        setTimeout(function() {
            window.location.href = 'index.html';
        }, 3000);
    });
});
