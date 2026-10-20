// The attachments of an estimate request (PRD FR-2): reference photos and design files the customer
// adds to the request. One component for the four estimate pages.
//
//   var attachments = BridgePathAttachments.mount(host, { onChange: function () {} });
//   attachments.getFiles()      -> the File objects to send with the request
//   attachments.setAutoFile(f)  -> the photo the AI analysed (sunglasses): put first, marked, and
//                                  replaced or removed when the analysis starts again; null removes it
//   attachments.reset()         -> empties the list (after a successful request)
//
// The checks are those of estimate-api.js (type, 10 MB a file, 5 files, 30 MB together, a file of
// the same name and size is marked). The API checks everything again, by content. Every text is put
// in with textContent and every element is created; a file name never goes into markup.
(function () {
    'use strict';

    var ACCEPT = '.jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf';
    var MB = 1024 * 1024;

    var TEXTS = Object.freeze({
        title: '참고 이미지·디자인 파일 (선택)',
        hint: 'JPG, PNG, WEBP, PDF 파일을 파일당 10MB, 최대 5개, 전체 30MB까지 첨부할 수 있어요. AI·PSD·EPS 같은 디자인 원본이나 압축 파일은 접수 후 담당자와 이메일로 주고받아 주세요.',
        add: '파일 추가',
        remove: '삭제',
        auto: 'AI 분석에 쓴 사진',
        duplicate: '같은 파일이 이미 있어요',
        none: '첨부한 파일이 없어요.',
        autoFailed: '분석한 사진은 첨부하지 못했어요.'
    });

    function api() {
        var estimate = globalThis.BridgePathEstimate;
        if (!estimate) {
            throw new Error('estimate-api.js has to be loaded before estimate-attachments.js');
        }
        return estimate;
    }

    function formatSize(bytes) {
        if (bytes >= MB) {
            return (Math.round((bytes / MB) * 10) / 10) + 'MB';
        }
        return Math.max(1, Math.round(bytes / 1024)) + 'KB';
    }

    function create(tag, className, text) {
        var element = document.createElement(tag);
        if (className) {
            element.className = className;
        }
        if (text !== undefined) {
            element.textContent = text;
        }
        return element;
    }

    function meta(file) {
        return { name: file.name, size: file.size, type: file.type };
    }

    // options: onChange() -> called after every change of the list.
    function mount(host, options) {
        var estimate = api();
        var settings = options || {};
        var policy = estimate.FILE_POLICY;
        var items = []; // { file, auto, duplicate }
        var locked = false;

        host.textContent = '';
        host.classList.add('attachments');

        var title = create('p', 'attachments-title', TEXTS.title);
        var hint = create('p', 'form-hint attachments-hint', TEXTS.hint);
        hint.id = host.id ? host.id + 'Hint' : 'attachmentsHint';

        var input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.accept = ACCEPT;
        input.className = 'attachments-input';
        input.setAttribute('aria-describedby', hint.id);
        input.tabIndex = -1;
        input.hidden = true;

        var addButton = create('button', 'attachments-add', TEXTS.add);
        addButton.type = 'button';
        addButton.setAttribute('aria-describedby', hint.id);

        var list = create('ul', 'attachments-list');
        list.setAttribute('aria-label', '첨부한 파일');
        var summary = create('p', 'attachments-summary');
        summary.setAttribute('aria-live', 'polite');
        var problems = create('div', 'attachments-problems');
        problems.setAttribute('role', 'alert');
        problems.hidden = true;

        [title, hint, addButton, input, list, summary, problems].forEach(function (element) {
            host.appendChild(element);
        });

        function totalBytes() {
            return items.reduce(function (sum, item) { return sum + (item.file.size || 0); }, 0);
        }

        function showProblems(messages) {
            problems.textContent = '';
            messages.forEach(function (text) {
                problems.appendChild(create('p', 'field-error', text));
            });
            problems.hidden = messages.length === 0;
        }

        function changed() {
            if (typeof settings.onChange === 'function') {
                settings.onChange();
            }
        }

        function render() {
            list.textContent = '';
            items.forEach(function (item, index) {
                var row = create('li', 'attachments-item');
                row.appendChild(create('span', 'attachments-name', item.file.name));
                row.appendChild(create('span', 'attachments-size', formatSize(item.file.size)));
                if (item.auto) {
                    row.appendChild(create('span', 'attachments-tag', TEXTS.auto));
                }
                if (item.duplicate) {
                    row.appendChild(create('span', 'attachments-tag attachments-tag-warning', TEXTS.duplicate));
                }
                var remove = create('button', 'attachments-remove', TEXTS.remove);
                remove.type = 'button';
                remove.setAttribute('aria-label', item.file.name + ' ' + TEXTS.remove);
                remove.disabled = locked;
                remove.addEventListener('click', function () {
                    items.splice(index, 1);
                    markDuplicates();
                    showProblems([]);
                    render();
                    changed();
                    addButton.focus();
                });
                row.appendChild(remove);
                list.appendChild(row);
            });
            summary.textContent = items.length === 0
                ? TEXTS.none
                : items.length + '/' + policy.maxFiles + '개 · ' + formatSize(totalBytes()) + ' / ' + (policy.maxTotalBytes / MB) + 'MB';
            addButton.disabled = locked;
            input.disabled = locked;
        }

        // A file with the name and size of another one is marked, so the customer can take it away.
        function markDuplicates() {
            var seen = {};
            items.forEach(function (item) {
                var key = item.file.name + '|' + item.file.size;
                item.duplicate = seen[key] === true;
                seen[key] = true;
            });
        }

        // Adds what passes the checks; returns the messages of what does not.
        function add(files, auto) {
            var current = items.map(function (item) { return meta(item.file); });
            var result = estimate.validateFiles(current, files.map(meta));
            var messages = result.rejected.map(function (entry) {
                return estimate.messageForFile(entry.code, entry.name);
            });
            var acceptedNames = {};
            result.accepted.forEach(function (file) { acceptedNames[file.name + '|' + file.size] = true; });
            files.forEach(function (file) {
                if (acceptedNames[file.name + '|' + file.size]) {
                    var entry = { file: file, auto: !!auto, duplicate: false };
                    if (auto) {
                        items.unshift(entry);
                    } else {
                        items.push(entry);
                    }
                }
            });
            markDuplicates();
            return messages;
        }

        function addFiles(files) {
            var messages = add(files, false);
            showProblems(messages);
            render();
            changed();
        }

        function removeAuto() {
            var before = items.length;
            items = items.filter(function (item) { return !item.auto; });
            return items.length !== before;
        }

        // The photo that was analysed: one at a time, always the newest.
        function setAutoFile(file) {
            var removed = removeAuto();
            var messages = [];
            if (file) {
                messages = add([file], true).map(function () { return TEXTS.autoFailed; });
            }
            markDuplicates();
            showProblems(messages);
            render();
            if (removed || file) {
                changed();
            }
        }

        addButton.addEventListener('click', function () {
            if (!locked) {
                input.click();
            }
        });
        input.addEventListener('change', function () {
            var chosen = Array.prototype.slice.call(input.files || []);
            input.value = '';
            if (chosen.length > 0) {
                addFiles(chosen);
            }
        });

        // Files dropped on the block are added like the chosen ones.
        host.addEventListener('dragover', function (event) {
            event.preventDefault();
        });
        host.addEventListener('drop', function (event) {
            event.preventDefault();
            var dropped = event.dataTransfer ? Array.prototype.slice.call(event.dataTransfer.files || []) : [];
            if (!locked && dropped.length > 0) {
                addFiles(dropped);
            }
        });

        render();

        var instance = {
            getFiles: function () { return items.map(function (item) { return item.file; }); },
            setAutoFile: setAutoFile,
            addFiles: addFiles,
            lock: function (value) { locked = !!value; render(); },
            reset: function () {
                items = [];
                showProblems([]);
                render();
                changed();
            }
        };
        globalThis.BridgePathAttachments.instance = instance;
        return instance;
    }

    var exported = { mount: mount, TEXTS: TEXTS, ACCEPT: ACCEPT, instance: null };
    globalThis.BridgePathAttachments = exported;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = exported;
    }
})();
