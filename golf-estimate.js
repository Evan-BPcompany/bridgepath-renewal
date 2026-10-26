// 이 페이지에만 필요한 동작을 두는 자리입니다.
// 단계 이동·입력 검증·API 제출은 estimate-common.js와 estimate-flow.js가 공통으로 처리합니다.
// 골프티는 이 페이지의 유일한 제품이라, 1단계의 카드를 방문자 대신 선택해 둡니다.
document.addEventListener('DOMContentLoaded', function () {
    var card = document.querySelector('.category-card[data-category="golf_tee"]');
    if (card) {
        card.click();
    }
});
