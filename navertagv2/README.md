# NaverTag V2

네이버 스마트스토어 #검색어 후보 생성과 확장프로그램 검증 큐를 준비하는 로컬 웹앱입니다.

## 실행

단독 실행:

```bat
run.bat
```

ProductManager와 함께 실행:

```bat
C:\Users\rkghr\Desktop\ProductManager\run.bat
```

ProductManager 실행 시 `http://127.0.0.1:5000`이 열리고, 사이드바의 `네이버 태그` 메뉴로 `http://127.0.0.1:8787`에 접근할 수 있습니다.

## 키 저장 위치

```text
C:\Users\rkghr\Desktop\key\navertagv2.keys.json
```

기존 파일도 일부 자동 감지합니다.

```text
C:\Users\rkghr\Desktop\key\naver_client_key.txt
```

## 입력 형식

CSV/TSV 헤더 권장:

```csv
상품번호,상품명,카테고리,속성,기존태그
```

상품명만 줄 단위로 붙여넣어도 동작합니다.

## 현재 기능

- 상품명 기반 키워드 후보 20개 생성
- #검색어 10개 구성
- 키워드 재생성 체크 시 조합 변형
- 검색광고 API 키가 있으면 연관검색어/검색량 반영
- CSV 저장
- 확장프로그램 검증 큐 JSON 저장
- Chrome 확장프로그램 기본 골격 포함

## 확장프로그램

```text
C:\Users\rkghr\Desktop\프롬프트\navertagv2\extension
```

Chrome `chrome://extensions`에서 개발자 모드를 켠 뒤 압축해제된 확장프로그램으로 로드합니다.

현재 확장프로그램은 셀러센터 페이지에서 태그 입력 영역과 확인 버튼 후보를 탐색하는 기본 골격입니다. F12 Network 분석 후 `content.js`에 실제 태그 입력/검증/저장 로직을 연결하면 됩니다.
