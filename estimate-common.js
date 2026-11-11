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

// Enter and Space do what a click does, for the cards and the upload box (they are not buttons in the markup).
function actsLikeButton(element) {
    element.setAttribute('role', 'button');
    element.setAttribute('tabindex', '0');
    element.addEventListener('keydown', function(event) {
        if (event.target === element && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            element.click();
        }
    });
}

// ==================== Step 1: Category Selection ====================
document.addEventListener('DOMContentLoaded', function() {
    const categoryCards = document.querySelectorAll('.category-card');
    // The two ways to start (step 1) and the links of step 2 that change the way.
    const startButtons = document.querySelectorAll('[data-start]');

    // 카테고리 카드 클릭 이벤트
    categoryCards.forEach(card => {
        actsLikeButton(card);
        card.setAttribute('aria-pressed', 'false');
        card.addEventListener('click', function() {
            // 이전 선택 제거
            categoryCards.forEach(c => {
                c.classList.remove('selected');
                c.setAttribute('aria-pressed', 'false');
            });

            // 새로운 선택 추가
            this.classList.add('selected');
            this.setAttribute('aria-pressed', 'true');
            selectedCategory = this.getAttribute('data-category');

            // "다음 단계로" 버튼과 시작 방법 버튼 활성화
            const nextBtn = document.getElementById('nextBtn1');
            if (nextBtn) {
                nextBtn.disabled = false;
            }
            startButtons.forEach(button => {
                button.disabled = false;
            });
        });
    });

    // The way the visitor starts: with a reference image or without one. It is kept on the body, and
    // estimate-common.css shows or hides the upload areas of step 2 by it. Nothing is cleared: what was
    // already uploaded stays in sight and goes with the request.
    startButtons.forEach(button => {
        button.addEventListener('click', function() {
            document.body.setAttribute('data-input-mode', this.getAttribute('data-start') === 'manual' ? 'manual' : 'image');
            // A card of step 1 also moves on (nextBtn1 does it itself, below).
            if (this.id !== 'nextBtn1' && this.closest('#step1-content') && selectedCategory) {
                goToStep(2);
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
        actsLikeButton(imageUploadBox);

        // 클릭해서 파일 선택
        imageUploadBox.addEventListener('click', function() {
            imageInput.click();
        });

        // 파일 선택 후 처리: 상자에는 파일 이름만 글자로 넣는다 (마크업으로 넣지 않는다).
        imageInput.addEventListener('change', function(e) {
            const file = e.target.files[0];
            if (file) {
                const icon = document.createElement('div');
                icon.className = 'upload-icon';
                icon.setAttribute('aria-hidden', 'true');
                icon.textContent = '✓';
                const name = document.createElement('p');
                name.textContent = file.name;
                const note = document.createElement('p');
                note.className = 'upload-note';
                note.textContent = '선택됨 · 다른 사진으로 바꾸려면 다시 눌러 주세요';
                imageUploadBox.replaceChildren(icon, name, note);
            }
        });

        // 드래그 앤 드롭
        imageUploadBox.addEventListener('dragover', function(e) {
            e.preventDefault();
            imageUploadBox.classList.add('is-drag');
        });

        imageUploadBox.addEventListener('dragleave', function() {
            imageUploadBox.classList.remove('is-drag');
        });

        imageUploadBox.addEventListener('drop', function(e) {
            e.preventDefault();
            imageUploadBox.classList.remove('is-drag');

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
