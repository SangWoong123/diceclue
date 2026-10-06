# DiceClue

매일 같은 주사위 6개, 숨은 단어 하나. 단어를 만들어 클루 글자를 확인하고 정답을 맞히는 데일리 퍼즐.

```bash
npm install
npm run dev     # 개발 서버
npm run build   # 프로덕션 빌드 (dist/)
npm run lint    # oxlint
npm test        # node --test (이벤트 집계 서버 로직)
```

Cloudflare Workers 정적 자산으로 배포되고, GitHub `main` 에 push 하면 자동 재배포된다.

## 기록은 전부 로컬

공유 순위표는 없다. 개인 기록은 이 기기의 `localStorage` 에만 남고 서버로 보내지 않는다 (서버로 가는 건 아래의 익명 이벤트 카운트뿐).

| 키 | 내용 |
| --- | --- |
| `dc_stats` | 개인 통계 — 맞힌 날 수, 연속 정답(streak), 최고 연속, 최소/누적 롤 수 |
| `dc_progress_<UTC날짜>` | 오늘 판의 진행 상황 (지난 날짜 키는 자동 정리) |
| `dc_seen_howto` | 첫 방문 안내를 봤는지 |
| `dc_ev_<퍼즐번호>` | 이 퍼즐의 `start`/`finish` 이벤트를 이미 보냈는지 (`s`/`f`) |
| `dc_nolog` | `1` 이면 이 브라우저는 이벤트와 Web Analytics 비콘을 보내지 않음 |

시크릿 모드 등에서는 `localStorage` 접근 자체가 예외를 던질 수 있어 모든 읽기/쓰기가 감싸져 있다. 저장이 막혀도 게임은 그대로 돌아가고 기록만 남지 않는다. `loadStats()` 는 값이 깨졌거나 예전 버전이 일부 필드만 남겼더라도 항상 온전한 객체를 돌려준다.

## 익명 퍼즐 이벤트 카운트

플레이 수를 알기 위한 최소한의 집계. 쿠키·식별자·IP·UA 원문은 저장하지 않는다.

- 클라이언트(`src/events.js`)가 `POST /api/e` 로 `{e, p, r}` 만 보낸다 (`navigator.sendBeacon`, 실패 시 `fetch keepalive`).
  - `start` — 퍼즐의 첫 입력(주사위 탭 또는 정답 제출). 퍼즐당 브라우저 1회.
  - `finish` — 정답을 맞힘 (`r: "win"`). 퍼즐당 1회. 게임에 패배 조건이 없어 `lose` 는 서버만 받을 준비가 돼 있다.
  - `share` — 공유 버튼 클릭(헤더·승리 모달), 클릭마다.
- 서버(`src/server/events.js`)는 봇·헤드리스·curl/python 등 UA 를 무시하고, UA 에서 `mobile/desktop/tablet` 만 뽑은 뒤 버린다. 저장하는 건 **(이벤트를 받은 UTC 날짜, 이벤트, 퍼즐 번호, 결과, 국가 `request.cf.country`, 기기 종류) 별 카운터**뿐이다.
- 저장소: SQLite 기반 Durable Object `EventCounter` 하나 (Workers Free 플랜, `wrangler.jsonc` 의 migrations 로 배포 때 자동 생성).
- 검증: 이벤트 이름·필드 화이트리스트, 퍼즐 번호는 오늘(UTC) ±1, 본문 256바이트 이하, POST 만, 다른 출처(Origin/Sec-Fetch-Site)는 403. `?dry=1` 은 모든 검사를 하되 저장하지 않는다 (라이브 점검용).
- 읽기: `GET /api/stats?days=7` (1–90) — 날짜별 starts / finishes(win·lose) / shares 와 퍼즐·국가·기기별 분해. 집계값만 나온다.
- 우리 쪽 테스트 브라우저는 아무 페이지나 `?nolog=1` 로 한 번 열면 그 브라우저는 이후 이벤트도 Web Analytics 비콘도 보내지 않는다. `?nolog=0` 으로 해제.

## 클루 확인 로직은 한 군데

`buildConfirmed(secretWord, foundOrder)` 하나가 "정답 단어의 어느 자리가 플레이로 확인됐는가"를 판정하고, 승리 모달 · 공유 문구 · 공유 이미지가 **메모된 결과 하나**를 나눠 쓴다. 표기도 `SQ_CONFIRMED`/`SQ_BLIND`(이모지)와 `HEX_CONFIRMED`/`HEX_BLIND`(캔버스) 상수 한 쌍에서만 나오므로, 세 곳이 다시 어긋날 수 없다.

중복 글자는 정직하게 다룬다 — `LATEST` 에서 `T` 를 한 번만 찾았다면 앞쪽 `T` 한 자리만 확인된 것으로 표시된다.

## 사전을 번들에 그대로 두는 이유

`WORD_LIST_STR` (26,578 단어) 는 소스에 인라인돼 있다. raw 164KB / gzip 59KB 로 번들 gzip 144KB 중 약 40% 를 차지한다.

`public/` 로 빼서 fetch 하는 방안을 검토했지만 택하지 않았다. 첫 렌더에서 이미 사전이 필요하기 때문이다 — 초기 주사위는 `rollPlayable` → `boardHasWord` 로 "최소 한 단어는 만들 수 있는 눈"인지 검사해서 뽑고, 오늘의 정답 단어도 같은 시점에 결정된다. 분리하면 로딩 상태와 fetch 실패 폴백이 새로 필요해지는데, 하루 한 판짜리 게임에서 gzip 59KB 를 아끼려고 치르기에는 비싼 값이다. 사전이 이 규모를 크게 넘어서거나 첫 화면이 사전 없이도 그려지도록 바뀐다면 그때 다시 볼 것.
