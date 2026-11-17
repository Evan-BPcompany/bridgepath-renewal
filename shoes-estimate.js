// 이 페이지에만 필요한 동작을 두는 자리입니다.
// 단계 이동·입력 검증·API 제출은 estimate-common.js와 estimate-flow.js가 공통으로 처리합니다.
// 골프화는 이 페이지의 유일한 제품이라, 1단계의 카드를 방문자 대신 선택해 둡니다.
//
// 사진으로 시작합니다(2026-11-17): "사진 올리고 시작"을 한 번 누르면 2단계로 가면서 사진 선택 창이 바로 열립니다.
// 사진을 고르면 golf-shoe-photo.js가 분석하고 가격 범위를 보여 줍니다.
document.addEventListener('DOMContentLoaded', function () {
    var card = document.querySelector('.category-card[data-category="other"]');
    if (card) {
        card.click();
    }

    var start = document.getElementById('nextBtn1');
    var input = document.getElementById('shoeImage');
    if (start && input) {
        // estimate-common.js has already moved to step 2 and set the way (it listens first); the chooser opens in the same click.
        start.addEventListener('click', function () {
            if (document.body.getAttribute('data-input-mode') === 'image') {
                input.click();
            }
        });
    }
});
