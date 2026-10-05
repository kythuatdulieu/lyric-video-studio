# Đóng góp cho Lydra

Báo lỗi, đề xuất, sửa code hoặc cải thiện tài liệu đều được hoan nghênh. Các phần còn thiếu được liệt kê trong [README](README.md).

## Gửi thay đổi

1. Fork repo và clone bản fork về máy.
2. Tạo nhánh, ví dụ `git switch -c fix/lyric-timing`.
3. Cài theo README, sửa phần bạn muốn cải thiện.
4. Kiểm tra thay đổi bằng các lệnh bên dưới. Với logic căn lời hoặc render, bổ sung test cho trường hợp lỗi cụ thể; với giao diện, kiểm tra preview và đính kèm ảnh nếu hữu ích.
5. Commit, push nhánh lên fork rồi mở Pull Request về nhánh `main` của repo này. Mô tả ngắn vấn đề, thay đổi và cách đã kiểm tra.

```sh
npm ci
npm run typecheck
npm test
npm run build
```

CI sẽ tự chạy các kiểm tra này trên pull request; không cần API key cho CI. Chủ repo sẽ review và merge các thay đổi phù hợp.

## Báo lỗi và đề xuất

Mở Issue với bước tái hiện, kết quả mong đợi, kết quả thực tế và môi trường sử dụng. Lỗi timing nên kèm một đoạn lời ngắn và các mốc bị lệch; chỉ chia sẻ audio/ảnh mà bạn có quyền công khai.

Không đưa `.env`, API key, dữ liệu trong `.lydra/` hoặc file nhạc cá nhân vào commit, log hay ảnh chụp. Dùng `.env.example` để mô tả cấu hình mới.

Các đóng góp được phân phối theo giấy phép MIT của dự án.
