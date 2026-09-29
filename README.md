# Letter Rain

하늘에서 글자가 비처럼 내리고, 바닥에 모래처럼 쌓이고, 와이퍼가 쓸어내는 인터랙티브 웹사이트.
HTML / CSS / JavaScript만 사용했고 빌드 과정이 없습니다.
글자는 실제 글자 모양대로 부딪히고 쌓이며, 물리 계산에는 [Matter.js](https://brm.io/matter-js/)(MIT, `matter.min.js`로 포함)를 사용합니다.

## 조작

- **키보드 입력** — 누른 글자가 하늘에서 떨어짐
- **화면 클릭 / 터치** — 그 자리에서 글자가 터져 나옴
- **Space** 또는 **와이퍼 버튼** — 와이퍼 작동
- **메시지 입력** — 한 단어(한글 가능)가 나란히 떨어짐
- **자동** — 와이퍼가 불규칙한 간격으로 알아서 작동
- 글자는 화면 높이의 60%까지만 쌓이고, 넘치면 먼저 떨어진 글자부터 사라짐

## GitHub Pages로 배포

1. 새 저장소를 만들고 `index.html`, `style.css`, `script.js`, `matter.min.js`, `README.md`를 루트에 올립니다.
2. 저장소 **Settings → Pages**에서 Source를 `Deploy from a branch`, 브랜치 `main` / 폴더 `/ (root)`로 지정합니다.
3. 잠시 후 `https://<아이디>.github.io/<저장소이름>/`에서 확인할 수 있습니다.

## 커스터마이즈

`script.js` 상단 설정값:

| 상수 | 의미 |
|---|---|
| `SETS` | 내리는 글자 목록 |
| `PALETTE` | 글자 색 |
| `FILL_LIMIT` | 글자가 쌓이는 최대 높이 (기본 0.6 = 60%) |
| `WIPE_TIME` | 와이퍼 왕복 시간(초) |
