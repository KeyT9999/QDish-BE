# Thiết kế cách ly dữ liệu phân tích khách hàng theo nhà hàng

## Bối cảnh

Merchant Insights hiện tổng hợp phân khúc khách hàng từ `UserDiningProfile`. Model này không có `restaurantId`, vì vậy truy vấn có thể trộn hồ sơ của nhiều nhà hàng. Hệ thống không yêu cầu khách đăng nhập, nên `guestUserId` trong trình duyệt chỉ nhận diện được một trình duyệt/thiết bị, không phải một con người.

Thiết kế này chọn đơn vị phân tích là **lượt ghé/lượt khảo sát ẩn danh tại một nhà hàng**, không cố nhận diện khách hàng duy nhất.

## Mục tiêu

- Cách ly tuyệt đối dữ liệu Merchant Insights theo `restaurantId`.
- Ghi nhận một lượt khảo sát cho mỗi trình duyệt trong một phiên bàn.
- Không đếm trùng khi khách gửi lại hoặc sửa khảo sát trong cùng phiên.
- Không thu thập thêm danh tính cá nhân.
- Không suy diễn hoặc gán dữ liệu cũ cho một nhà hàng khi không có bằng chứng.

## Ngoài phạm vi

- Nhận diện khách quay lại trên nhiều thiết bị.
- Chương trình thành viên, đăng nhập hoặc hợp nhất hồ sơ.
- Học sở thích từ lịch sử đặt món.
- Thay đổi thuật toán Fit Score hoặc Recommendation Engine.

## Mô hình dữ liệu

Tạo collection `AnonymousDiningVisit` với các trường:

```ts
interface IAnonymousDiningVisit {
  restaurantId: ObjectId;
  tableSessionId: ObjectId;
  visitToken: string;
  goalsSnapshot: string[];
  dietaryPreferencesSnapshot: string[];
  source: "ONBOARDING";
  recordedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}
```

Ràng buộc duy nhất:

```ts
{ restaurantId: 1, tableSessionId: 1, visitToken: 1 }
```

`visitToken` là token ngẫu nhiên không chứa PII. Backend chỉ lưu token sau khi đã kiểm tra định dạng và giới hạn độ dài. Dị ứng không được sao chép vào collection phân tích vì Merchant Insights không sử dụng dữ liệu này.

## Vòng đời visit token

Frontend tạo token bằng `crypto.randomUUID()` sau khi đã resolve được `tableSessionId`. Token được lưu trong `sessionStorage` theo khóa:

```text
qdish_visit:{restaurantId}:{tableSessionId}
```

- Cùng trình duyệt, cùng phiên bàn: tái sử dụng token.
- Gửi lại onboarding: cập nhật bản ghi cũ.
- Phiên bàn mới: sinh token mới.
- Nhiều điện thoại trong cùng phiên bàn: mỗi điện thoại có thể tạo một lượt khảo sát.

Khóa `qdish_guest_user_id` và hồ sơ trong `localStorage` được giữ lại để không phá vỡ trải nghiệm Recommendation hiện tại, nhưng không còn là nguồn dữ liệu cho Merchant Insights.

## Hợp đồng API

### Ghi nhận hoặc cập nhật lượt khảo sát

```http
POST /api/restaurants/:restaurantId/dining-visits
Content-Type: application/json
```

```json
{
  "tableSessionId": "object-id",
  "visitToken": "uuid",
  "goals": ["MUSCLE_GAIN"],
  "dietaryPreferences": ["VEGETARIAN"]
}
```

Xử lý theo ngữ nghĩa upsert:

- `201 Created` khi tạo lượt mới.
- `200 OK` khi cập nhật lượt đã tồn tại.
- Response không trả về toàn bộ snapshot; chỉ trả `{ id, recordedAt, created }`.

Kiểm tra biên:

- `restaurantId` và `tableSessionId` là Mongo ObjectId hợp lệ.
- Table session tồn tại và có cùng `restaurantId`.
- Chỉ chấp nhận session `OPEN` hoặc `PAYMENT_REQUESTED`.
- `visitToken` là UUID hợp lệ.
- Mảng có giới hạn số phần tử, loại trùng và chỉ nhận enum cho phép.
- Session sai nhà hàng trả `404` để không làm lộ quan hệ tenant.

Endpoint là public vì khách không đăng nhập. Việc xác thực ngữ cảnh dựa trên phiên bàn hợp lệ; endpoint phải được thiết kế để có thể bổ sung rate limit mà không đổi contract.

## Luồng frontend

1. `CustomerMenu` resolve phiên bàn.
2. Frontend lấy hoặc tạo `visitToken` cho `restaurantId + tableSessionId`.
3. `DiningOnboarding` tiếp tục lưu hồ sơ cục bộ và endpoint hồ sơ hiện hành để giữ tương thích Recommendation.
4. Sau khi lưu hồ sơ, frontend gửi snapshot phân tích tới endpoint dining visits.
5. Nếu ghi analytics thất bại, hồ sơ cục bộ và onboarding vẫn hoàn tất; frontend không chặn khách gọi món. Lỗi được log ngắn gọn và không hiển thị dữ liệu nhạy cảm.

## Merchant Insights

`MerchantInsightService` truy vấn `AnonymousDiningVisit` bằng cả `restaurantId` và khoảng thời gian. Phân khúc được tổng hợp từ `goalsSnapshot`.

Không còn:

- Truy vấn `UserDiningProfile` toàn hệ thống.
- Giới hạn 200 hồ sơ không có thứ tự xác định.
- Tự chèn dữ liệu phân khúc mô phỏng khi chưa đủ dữ liệu.

Giao diện dùng các nhãn:

- "Lượt khảo sát" thay cho "khách hàng duy nhất".
- Khi dữ liệu rỗng, hiển thị trạng thái cần thêm dữ liệu với giá trị thật bằng 0.

## Dữ liệu cũ và triển khai

Không backfill `UserDiningProfile` sang `AnonymousDiningVisit` vì dữ liệu cũ không có quan hệ nhà hàng đáng tin cậy. Collection cũ được giữ lại cho Recommendation Engine trong phạm vi thay đổi này.

Merchant Insights bắt đầu tích lũy phân khúc từ thời điểm deploy. Không xóa dữ liệu cũ trong migration này.

## Kiểm thử

### Model/service

- Hai visit có cùng token và session được upsert thành một bản ghi.
- Cùng token nhưng khác session tạo hai lượt.
- Nhiều token trong cùng session tạo nhiều lượt.
- Truy vấn insights của nhà hàng A không bao giờ chứa visit của nhà hàng B.
- Bộ lọc `today`, `week`, `month`, `year`, `all` áp dụng lên `recordedAt`.

### API

- Reject ObjectId, UUID, enum và array không hợp lệ.
- Reject session không tồn tại, đã đóng hoặc thuộc tenant khác.
- Phân biệt response tạo mới và cập nhật.

### Frontend

- Token ổn định trong cùng restaurant/session.
- Token thay đổi khi session thay đổi.
- Submit analytics gửi đúng `restaurantId`, `tableSessionId` và snapshot.
- Lỗi analytics không làm hỏng onboarding hoặc luồng đặt món.

### Hồi quy

- Recommendation Engine vẫn đọc hồ sơ hiện hành.
- Merchant Insights vẫn trả đúng response shape mà frontend đang sử dụng.
- Build TypeScript backend và frontend thành công.

## Tiêu chí hoàn thành

- Không còn truy vấn `UserDiningProfile` trong Merchant Insights.
- Mọi bản ghi phân tích đều gắn bắt buộc với một nhà hàng và một phiên bàn hợp lệ.
- Test chứng minh dữ liệu hai nhà hàng không bị trộn.
- Gửi lại khảo sát trong cùng visit không tăng số lượt.
- Dữ liệu mô phỏng không còn được dùng cho phân khúc khách hàng.
