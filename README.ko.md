# GPT Image Bulk Downloader

> ChatGPT 이미지를 대량으로 다운로드하고, 사용한 프롬프트를 PNG 메타데이터에 보존하는 Chrome 확장 프로그램입니다.

[English README](./README.md)

GPT Image Bulk Downloader는 ChatGPT 이미지 생성 작업을 많이 하는 사용자를 위한 로컬 전용 Manifest V3 Chrome 확장 프로그램입니다. 수백 장, 수천 장의 이미지를 스캔하고 순차적으로 다운로드하며, 각 이미지가 어떤 프롬프트로 생성되었는지 나중에도 추적할 수 있도록 PNG 메타데이터와 CSV 매니페스트를 함께 남깁니다.

## 왜 필요한가요?

ChatGPT에서 이미지를 많이 만들면 저장해야 할 이미지가 빠르게 쌓입니다. 하나씩 열어서 저장하는 방식은 너무 느리고, 다운로드 후에는 어떤 프롬프트로 만든 이미지인지 헷갈리기 쉽습니다.

이 확장 프로그램은 다음 문제를 해결합니다.

- ChatGPT 이미지 대량 저장이 번거로운 문제
- 다운로드한 이미지와 원본 프롬프트가 분리되는 문제
- 오래된 이미지와 현재 로드된 이미지를 구분하기 어려운 문제
- 다운로드 도중 멈추고 싶어도 작업이 계속되는 문제

## 주요 기능

- 일반 ChatGPT 대화의 이미지 스캔
- `chatgpt.com/images/` 이미지 라이브러리 전용 스캔
- 두 가지 스캔 모드 제공:
  - **현재 로드 스캔**: 지금 페이지에 로드된 이미지 카드만 수집
  - **전체 이미지 스캔**: ChatGPT 이미지 라이브러리를 페이지네이션으로 전체 수집
- ChatGPT 기본 템플릿 카드 제외
- 수백 장, 수천 장 이미지 선택 후 순차 다운로드
- 각 이미지를 저장하기 직전에 가능한 최선의 프롬프트 자동 복원
- PNG `iTXt`, `tEXt`, XMP 메타데이터에 프롬프트 삽입
- CSV 매니페스트 저장
- 선택적 JSON 사이드카 저장
- 폴더명, 파일명 템플릿, 다운로드 간격, 재시도 횟수 설정
- 진행 중 작업 중단
  - 현재 진행 중인 fetch/download를 abort
  - 남은 큐는 실패가 아니라 skipped로 정리
- 외부 서버, 분석 도구, 트래커, 원격 코드 없음

## 설치 방법

필요 조건:

- Chrome 116 이상
- Node.js 20 이상

프로젝트 폴더에서 빌드합니다.

```powershell
npm run verify
npm run build
```

Chrome에 설치합니다.

1. Chrome에서 `chrome://extensions`를 엽니다.
2. 오른쪽 위 **개발자 모드**를 켭니다.
3. **압축해제된 확장 프로그램 로드**를 누릅니다.
4. 이 저장소의 `dist` 폴더를 선택합니다.

## 사용 방법

1. ChatGPT 대화 또는 `https://chatgpt.com/images/`를 엽니다.
2. 확장 프로그램 팝업을 엽니다.
3. 현재 화면에 로드된 이미지만 받고 싶으면 **현재 로드 스캔**을 누릅니다.
4. ChatGPT 이미지 라이브러리 전체를 받고 싶으면 **전체 이미지 스캔**을 누릅니다.
5. 다운로드할 이미지를 선택합니다.
6. 폴더명, 다운로드 간격, 재시도 횟수, 메타데이터 옵션을 설정합니다.
7. 다운로드 버튼을 누릅니다.
8. 진행 중 멈추고 싶으면 **중지**를 누릅니다.

기본 저장 폴더:

```text
GPT Images/{date}
```

## 파일명 템플릿

지원하는 토큰:

- `{date}`: `YYYY-MM-DD`
- `{time}`: `HHMMSS`
- `{index}`: 0001부터 시작하는 순번
- `{prompt}`: 프롬프트 요약
- `{conversation}`: 대화 제목
- `{imageId}`: 감지된 이미지 ID

## PNG 메타데이터

메타데이터 삽입 옵션이 켜져 있으면, 필요한 경우 이미지를 PNG로 변환한 뒤 다음 영역에 프롬프트를 기록합니다.

- `iTXt` `Prompt`
- `iTXt` `ChatGPT Prompt`
- `iTXt` `GPT Image Metadata`
- `iTXt` `XML:com.adobe.xmp`
- `tEXt` `Description`
- `tEXt` `Comment`

Windows 탐색기의 자세히 보기 패널은 Windows 버전이나 코덱 상태에 따라 일부 PNG 메타데이터를 표시하지 않을 수 있습니다. 그래도 프롬프트는 PNG 내부 청크에 저장되며, CSV/JSON 파일로도 추적할 수 있습니다.

## 개발 및 검증

```powershell
npm run audit
npm run cancel-smoke
npm run verify
npm run build
npm run package
```

로그인된 ChatGPT 브라우저를 Chrome DevTools Protocol로 띄운 상태라면 라이브 검증도 실행할 수 있습니다.

```powershell
$env:GPTIMG_CDP_PORT = "9241"
npm run live-smoke
```

Chrome 빌드에서 CDP Extensions 도메인이 막혀 있으면 `chrome://extensions`에서 `dist`를 직접 로드한 뒤 확장 프로그램 ID를 지정합니다.

```powershell
$env:GPTIMG_CDP_PORT = "9241"
$env:GPTIMG_EXTENSION_ID = "your_extension_id"
npm run live-smoke
```

라이브 검증은 이미지 스캔, 템플릿 제외, 프롬프트 복원, PNG 메타데이터, CSV/JSON 출력, 실제 다운로드, 중단 동작을 확인합니다.

## 릴리스 ZIP 만들기

```powershell
npm run package
```

생성 위치:

```text
release/gpt-image-bulk-downloader.zip
```

배포 전 확인 문서:

- `RELEASE_CHECKLIST.md`
- `STORE_LISTING.md`
- `PRIVACY.md`
- `SECURITY.md`

## 개인정보

이 확장 프로그램은 사용자 데이터를 외부 서버로 수집, 판매, 전송, 저장하지 않습니다. 사용자가 스캔 또는 다운로드를 실행할 때만 ChatGPT 페이지와 사용자의 브라우저 세션에서 필요한 이미지/프롬프트 정보를 읽습니다. 설정값은 Chrome 로컬 저장소에만 저장됩니다.

## 라이선스

MIT
