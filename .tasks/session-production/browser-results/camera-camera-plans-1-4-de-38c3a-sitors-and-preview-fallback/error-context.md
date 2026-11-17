# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: camera.spec.ts >> camera plans 1/4, delayed JPEG, same-file retry, sequential visitors and preview fallback
- Location: tests/camera.spec.ts:13:1

# Error details

```
Tearing down "app" exceeded the test timeout of 120000ms.
```

# Page snapshot

```yaml
- generic [ref=f1e4]:
  - paragraph [ref=f1e5]: ФОТОГРАФИИ ПРИНЯТЫ
  - heading "Ищи свое видео под номером 002 на промо экране" [level=1] [ref=f1e6]:
    - text: Ищи свое видео под номером
    - generic [ref=f1e7]: "002"
    - text: на промо экране
  - button "Следующий посетитель" [ref=f1e8] [cursor=pointer]
```