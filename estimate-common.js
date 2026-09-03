// ==================== Step Navigation ====================
let selectedCategory = null;

function goToStep(stepNumber) {
    // 현재 step 내용 숨김
    const currentContent = document.querySelector('.step-content.active');
    if (currentContent) {
        currentContent.classList.remove('active');
    }

    const currentStep = document.querySelector('.step.active');
    if (currentStep) {
        currentStep.classList.remove('active');
    }

    // 새 step 보이기
    document.getElementById(`step${stepNumber}-content`).classList.add('active');
    document.getElementById(`step${stepNumber}`).classList.add('active');

    // 페이지 스크롤 최상단으로
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ==================== Step 1: Category Selection ====================
document.addEventListener('DOMContentLoaded', function() {
    // 카테고리 카드 클릭 이벤트
    document.querySelectorAll('.category-card').forEach(card => {
        card.addEventListener('click', function() {
            // 이전 선택 제거
            document.querySelectorAll('.category-card').forEach(c => {
                c.classList.remove('selected');
            });

            // 새로운 선택 추가
            this.classList.add('selected');
            selectedCategory = this.getAttribute('data-category');

            // "다음 단계로" 버튼 활성화
            const nextBtn = document.getElementById('nextBtn1');
            if (nextBtn) {
                nextBtn.disabled = false;
            }
        });
    });

    // "다음 단계로" 버튼 클릭
    const nextBtn = document.getElementById('nextBtn1');
    if (nextBtn) {
        nextBtn.addEventListener('click', function() {
            if (selectedCategory) {
                goToStep(2);
            }
        });
    }

    // ==================== Image Upload ====================
    const imageUploadBox = document.getElementById('imageUploadBox');
    let imageInputId = null;

    // 이미지 입력 필드 찾기 (신발 또는 선글라스)
    if (document.getElementById('shoeImage')) {
        imageInputId = 'shoeImage';
    } else if (document.getElementById('sunglassImage')) {
        imageInputId = 'sunglassImage';
    }

    if (imageUploadBox && imageInputId) {
        const imageInput = document.getElementById(imageInputId);

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
    }

    // 초기 상태: Step 1 활성화
    goToStep(1);
});
