# NaverTag V2 Helper

Chrome 확장프로그램 기본 골격입니다.

## 로드 방법

1. Chrome에서 `chrome://extensions` 열기
2. 개발자 모드 켜기
3. `압축해제된 확장 프로그램을 로드` 클릭
4. 이 폴더 선택

```text
C:\Users\rkghr\Desktop\프롬프트\navertagv2\extension
```

## 다음 작업

셀러센터 상품수정 페이지에서 F12 Network를 열고 `검색에 적용되는 태그 확인` 버튼을 누른 뒤 다음을 확인합니다.

- 버튼 클릭 시 호출되는 URL
- 요청 method
- request payload
- response 구조
- 태그 입력 DOM selector
- 결과 DOM selector

그 뒤 `content.js`의 탐색 로직을 실제 태그 입력/확인/저장 로직으로 교체합니다.
