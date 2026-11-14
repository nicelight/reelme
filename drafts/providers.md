## PRoviders   
 
  Используем только провайдера fal.ai.
  API изучены: [точные endpoints и ограничения](../.memory-bank/analysis/fal-api.md).
  Числа референсов ниже — исходные ориентиры; фактические API-лимиты приведены в исследовании.
  
  
###  Video-to-video  
  
1. MiniMax H3 Max Recast - (1 референс) лучший V2V, важно не писать промпт!
2. Kling O1 Edit Video [Pro] (4 референса), общий промпт обязателен.
3. Kling O3 Edit Video [Pro] (4 референса), общий промпт обязателен.
4. Kling 4 Video Editing (4 референса), общий промпт обязателен.
5. Kling 4 Flash Editing (4 референса), общий промпт обязателен.
  

  
### Photo-to-Video
  До 3 общих референсных фоток и до 3-4 фоток на каждого персонажа @Elemen1 и @Element2
  
1. Kling 4.0 Reference to Video ( 4+4 референса), общий промпт обязателен.
2. Kling O3 Reference to Video [Pro] ( 4+4 референса), общий промпт обязателен.
3. Kling 4 Flash Reference-to-Video, общий промпт обязателен.
4. H3 Max Reference to Video ( 3+3 референса), общий промпт обязателен.
5. Vidu Q4 Reference to Video (6+6 референсов), общий промпт обязателен.
6. Gemini Omni 1.2 Flash (4 референса), общий промпт обязателен. 
 
 
### First-last-shot

| Модель | Первый + последний кадр | Промежуточные кадры | Фото персонажей помимо кадров | 720p / 768p | Для лиц, на мой взгляд |
| --- | --- | --- | --- | --- | --- |
| kling/v4/reference-to-video | Да | До 8 (входят в лимит 10 картинок) | До 7 персонажей по 4 фото | 720p, 1080p | Лучший выбор |
| minimax/h3-max/reference-to-video | Да | 1, с точным временем (только 480P/768P) | До 9 фото общим списком | 768P, 1080P | Очень хорошо |
| fal-ai/kling-video/o3/pro/reference-to-video | Да | Нет | Персонажи по 4 фото | Не указано | Хорошо |
| google/gemini-omni-flash/v1.2/image-to-video | Да | Нет | Нет | 720p, 1080p | Средне |
| kling/v4/flash/reference-to-video | Только первый | Нет | До 7 персонажей по 4 фото | 720p | Не подходит |
| fal-ai/vidu/q4/reference-to-video | Нет | Нет | До 12 фото | 720p | Не подходит |
| fal-ai/kling-video/v3/pro/image-to-video | Да | Нет | Персонажи по 4 фото | Не указано | Хорошо |
| alibaba/wan-3.0-prime/image-to-video | Да | Нет | Нет | 720p, 1080p | Средне |
| blackforestlabs/flux-3-max/keyframes-to-video | Да | До 10 кадров с привязкой ко времени | Не проверено | 720p, 1080p | Не проверено |
