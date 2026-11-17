// 이 페이지에만 필요한 동작을 두는 자리입니다.
// 단계 이동·입력 검증·API 제출은 estimate-common.js와 estimate-flow.js가 공통으로 처리합니다.
//
// 사진으로 시작합니다(2026-11-17): 종류는 골프·스포츠 선글라스가 미리 골라져 있어(방문자가 다른 종류로 바꿀 수 있습니다)
// "사진 올리고 시작"을 한 번 누르면 2단계로 가면서 사진 선택 창이 바로 열립니다. 사진을 고르면 estimate-preview.js가 분석합니다.
document.addEventListener('DOMContentLoaded', function () {
    var card = document.querySelector('.category-card[data-category="sports"]');
    if (card) {
        card.click();
    }

    var start = document.getElementById('nextBtn1');
    var input = document.getElementById('sunglassImage');
    if (start && input) {
        // estimate-common.js has already moved to step 2 and set the way (it listens first); the chooser opens in the
        // same click, which the browser allows, and a visitor who cancels it stays in step 2 with the upload area in sight.
        start.addEventListener('click', function () {
            if (document.body.getAttribute('data-input-mode') === 'image') {
                input.click();
            }
        });
    }
});
