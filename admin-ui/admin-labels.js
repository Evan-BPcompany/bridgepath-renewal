// The words of the admin screen: what the codes of the API are called, and how values are shown.
// Plain data and small pure functions; nothing here touches the page.
(function () {
    'use strict';

    // The ten statuses of PRD FR-5.5, and the three retired by migration 013 that an old history
    // entry may still name.
    var STATUS = Object.freeze({
        new_receipt: '신규 접수',
        under_review: '정보 확인 중',
        info_requested: '추가정보 요청',
        factory_checking: '공장 견적 확인 중',
        quoted: '정식견적 발송',
        customer_review: '고객 검토 중',
        accepted: '진행 확정',
        on_hold: '보류',
        completed: '종결',
        cancelled: '취소'
    });
    var STATUS_ORDER = Object.freeze([
        'new_receipt', 'under_review', 'info_requested', 'factory_checking', 'quoted',
        'customer_review', 'accepted', 'on_hold', 'completed', 'cancelled'
    ]);
    var RETIRED_STATUS = Object.freeze({ rejected: '거절', archived: '보관', negotiating: '협의 중' });

    // How a status looks: the badge class says "needs attention", "waiting", "done" or "stopped".
    var STATUS_TONE = Object.freeze({
        new_receipt: 'new', under_review: 'work', info_requested: 'wait', factory_checking: 'work', quoted: 'work',
        customer_review: 'wait', accepted: 'good', on_hold: 'stop', completed: 'done', cancelled: 'stop'
    });

    var CATEGORY = Object.freeze({
        eyewear: '선글라스·안경',
        shoes: '신발',
        golf_products: '골프용품',
        other: '기타 맞춤 제품'
    });

    var CUSTOMER_TYPE = Object.freeze({
        individual_startup: '개인·창업 준비 중',
        business_brand: '사업자·브랜드 운영 중'
    });

    // How the customer sent it: anyone can send a simple request; only a signed-in customer asks the
    // staff for a detailed quote.
    var REQUEST_KIND = Object.freeze({
        simple: '간단 접수',
        detailed: '담당자 상세견적 요청'
    });

    var FILE_STATUS = Object.freeze({
        quarantine: '격리 (검사 전)',
        pending_scan: '검사 대기',
        approved: '승인',
        rejected: '거부'
    });
    var SCAN_STATUS = Object.freeze({ pending: '검사 전', passed: '통과', failed: '실패' });

    var ROLE = Object.freeze({ admin: '관리자', manager: '담당자' });

    // The keys of specification_json, per kind of value; the keys the forms write.
    var SPEC_KEY = Object.freeze({
        frame_type: '제품 종류', shoe_type: '제품 종류', product_type: '제품 종류',
        product_description: '제품 설명',
        material: '재질', lens_type: '렌즈 타입', frame_color: '프레임 색상', lens_color: '렌즈 색상',
        color: '색상', size: '크기', size_range: '사이즈 범위', sizes: '사이즈', design: '디자인', customization: '맞춤 요청',
        quantity: '수량', delivery_date: '희망 납기일', additional_info: '추가 요청사항', special_requirements: '추가 요청사항',
        schema_version: '양식 버전'
    });

    var SPEC_VALUE = Object.freeze({
        material: {
            metal: '금속 (메탈)', plastic: '플라스틱', acetate: '아세테이트', mixed: '혼합', wood: '우드', unknown: '잘 모르겠음',
            leather: '가죽', canvas: '캔버스', mesh: '메쉬', synthetic: '인공가죽', rubber: '고무',
            polyester: '폴리에스터', nylon: '나일론', cotton: '면', wool: '울'
        },
        lens_type: {
            normal: '일반 렌즈', polarized: '편광 렌즈', mirror: '미러 렌즈', gradient: '그래디언트 렌즈',
            photochromic: '변색 렌즈', unknown: '잘 모르겠음'
        },
        // The kind chosen on the first step of each form.
        frame_type: {
            optical: '일반 안경테', sunglasses: '선글라스', sports: '스포츠 선글라스', kids: '키즈 안경', safety: '기능성 안경'
        },
        shoe_type: {
            sneakers: '운동화', heels: '여성구두', mens: '남성구두', boots: '부츠', sandals: '샌들/슬리퍼', other: '기타'
        },
        product_type: {
            bags: '골프백', gloves: '골프 장갑', headwear: '골프 모자', accessories: '골프 액세서리',
            covers: '골프 커버·케이스', training: '골프 연습용품'
        }
    });

    var AI = Object.freeze({
        frame_material: SPEC_VALUE.material,
        lens_type: SPEC_VALUE.lens_type,
        confidence: { low: '낮음', medium: '보통', high: '높음' },
        complexity: { low: '낮음', medium: '중간', high: '높음' }
    });

    function pick(map, key, fallback) {
        return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : (fallback === undefined ? String(key) : fallback);
    }

    function statusLabel(status) {
        if (Object.prototype.hasOwnProperty.call(STATUS, status)) {
            return STATUS[status];
        }
        if (Object.prototype.hasOwnProperty.call(RETIRED_STATUS, status)) {
            return RETIRED_STATUS[status] + ' (이전 상태명)';
        }
        return status === null || status === undefined ? '' : String(status);
    }

    function statusTone(status) {
        return Object.prototype.hasOwnProperty.call(STATUS_TONE, status) ? STATUS_TONE[status] : 'stop';
    }

    // "2026-10-21 14:03" in Korean time, from the ISO time of the API.
    function formatDateTime(value) {
        if (!value) {
            return '';
        }
        var date = new Date(value);
        if (isNaN(date.getTime())) {
            return String(value);
        }
        try {
            var parts = new Intl.DateTimeFormat('en-CA', {
                timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit', hour12: false
            }).formatToParts(date);
            var get = function (type) {
                for (var i = 0; i < parts.length; i += 1) {
                    if (parts[i].type === type) {
                        return parts[i].value;
                    }
                }
                return '';
            };
            var hour = get('hour') === '24' ? '00' : get('hour');
            return get('year') + '-' + get('month') + '-' + get('day') + ' ' + hour + ':' + get('minute');
        } catch (error) {
            return String(value);
        }
    }

    function formatWon(amount) {
        return Number(amount).toLocaleString('ko-KR') + '원';
    }

    function formatBytes(bytes) {
        var size = Number(bytes);
        if (!isFinite(size) || size < 0) {
            return '';
        }
        if (size >= 1024 * 1024) {
            return (Math.round((size / (1024 * 1024)) * 10) / 10) + 'MB';
        }
        return Math.max(1, Math.round(size / 1024)) + 'KB';
    }

    // One value of the specification as text: a known code by its name, a list joined, the rest as it is.
    function specValue(key, value) {
        if (Array.isArray(value)) {
            return value.map(function (item) { return specValue(key, item); }).join(', ');
        }
        if (value === null || value === undefined || value === '') {
            return '';
        }
        if (typeof value === 'object') {
            return JSON.stringify(value);
        }
        if (key === 'quantity' && isFinite(Number(value))) {
            return Number(value).toLocaleString('ko-KR') + '개';
        }
        if (Object.prototype.hasOwnProperty.call(SPEC_VALUE, key)) {
            return pick(SPEC_VALUE[key], value, String(value));
        }
        return String(value);
    }

    var api = Object.freeze({
        STATUS: STATUS, STATUS_ORDER: STATUS_ORDER, CATEGORY: CATEGORY, CUSTOMER_TYPE: CUSTOMER_TYPE, REQUEST_KIND: REQUEST_KIND,
        FILE_STATUS: FILE_STATUS, SCAN_STATUS: SCAN_STATUS, ROLE: ROLE, SPEC_KEY: SPEC_KEY, AI: AI,
        pick: pick, statusLabel: statusLabel, statusTone: statusTone, formatDateTime: formatDateTime,
        formatWon: formatWon, formatBytes: formatBytes, specValue: specValue
    });
    globalThis.AdminLabels = api;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})();
