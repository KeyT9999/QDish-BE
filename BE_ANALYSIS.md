# BÁO CÁO PHÂN TÍCH CHI TIẾT BACKEND & ĐỐI CHIẾU FRONTEND MẪU (QDISH)

Báo cáo này được thực hiện nhằm phân tích toàn bộ cấu trúc mã nguồn backend (`QR_FOOD_ORDER_BE`) hiện tại, đối chiếu với các yêu cầu hiển thị và nghiệp vụ của Frontend mẫu (`FEMAU`), qua đó xác định những tính năng đã hoàn thành, những điểm thiếu hụt (Gap Analysis), các lỗi logic/thiết kế hiện tại, và đề xuất lộ trình hoàn thiện cho hệ sinh thái menu điện tử thông minh **QDish**.

---

## 1. Tổng quan backend hiện tại

### Công nghệ sử dụng
*   **Runtime & Framework:** Node.js (phiên bản ES Modules `"type": "module"`) kết hợp với **Express.js** (v4.18.2) viết bằng **TypeScript**.
*   **Database ORM:** **Mongoose** (v8.5.0) kết nối cơ sở dữ liệu **MongoDB**.
*   **Công cụ phát triển:** `tsconfig.json` cho cấu hình compiler TypeScript, `tsx` (v4.19.2) để chạy trực tiếp file TS trong môi trường phát triển (`npm run dev` thông qua lệnh `tsx watch src/index.ts`).
*   **Thư viện hỗ trợ khác:**
    *   `bcryptjs`: Mã hóa mật khẩu người dùng.
    *   `jsonwebtoken`: Tạo và xác thực JWT token cho cơ chế Authorization.
    *   `nodemailer`: Gửi email thông báo (mật khẩu tạm, OTP đổi email, OTP đổi tài khoản ngân hàng, thông báo đơn hàng mới).
    *   `node-fetch`: Thực hiện các request HTTP phục vụ gọi API VietQR bên thứ ba.
    *   `cors`: Cho phép chia sẻ tài nguyên giữa các nguồn khác nhau giữa BE và FE.

### Cấu trúc thư mục
Cấu trúc thư mục hiện tại của project `QR_FOOD_ORDER_BE/src` như sau:
```text
src/
├── config/
│   └── db.ts                   # Cấu hình kết nối MongoDB (Mongoose)
├── middleware/
│   └── auth.ts                 # Middleware requireAuth (JWT) và requireRole
├── models/
│   ├── User.ts                 # Schema User (Super Admin, Restaurant Admin, Staff)
│   ├── Restaurant.ts           # Schema nhà hàng (tên, email, ngân hàng...)
│   ├── Table.ts                # Schema bàn ăn của từng nhà hàng
│   ├── Category.ts             # Schema danh mục món ăn (Category)
│   ├── MenuItem.ts             # Schema chi tiết món ăn (Menu Item)
│   ├── Order.ts                # Schema đơn hàng (bao gồm OrderItem và trạng thái)
│   ├── PasswordResetToken.ts   # Token lưu OTP đặt lại mật khẩu
│   ├── EmailChangeToken.ts     # Token lưu OTP đổi email nhà hàng
│   └── BankAccountChangeToken.ts # Token lưu OTP đổi thông tin ngân hàng nhà hàng
├── routes/
│   ├── authRoutes.ts           # Router login, đổi mật khẩu, OTP reset mật khẩu
│   ├── restaurantRoutes.ts     # Router quản lý nhà hàng, thống kê, tạo VietQR (Router lớn nhất ~1166 lines)
│   ├── tableRoutes.ts          # Router lấy và đồng bộ số bàn ăn
│   ├── categoryRoutes.ts       # Router CRUD danh mục món ăn
│   ├── menuRoutes.ts           # Router CRUD món ăn
│   ├── staffRoutes.ts          # Router quản lý nhân viên, xem và xác nhận đơn hàng
│   └── orderRoutes.ts          # Router đặt món công khai và xem đơn hàng của bàn
├── scripts/
│   └── createSuperAdmin.ts     # Script CLI để khởi tạo tài khoản Super Admin ban đầu
├── services/
│   └── emailService.ts         # Service gửi email (Welcome, OTP, New Order)
└── index.ts                    # Entrypoint cấu hình Express app, CORS, Router mounting và khởi chạy Server
```

### Cách tổ chức Module / Controller / Service / Model
*   **Model:** Sử dụng Mongoose Schema định nghĩa các Entity tương ứng với các Collection trong MongoDB.
*   **Router & Business Logic:** Dự án **không tách biệt** tầng Controller và Router. Toàn bộ logic nghiệp vụ (Business Logic), kiểm tra dữ liệu đầu vào (Validation) và xử lý kết quả DB đều được viết trực tiếp bên trong các file Router nằm ở `src/routes/`.
*   **Service:** Dự án chỉ có một service chuyên biệt duy nhất là `emailService.ts` chịu trách nhiệm render template HTML/Text và gửi email qua SMTP.
*   **Config:** `db.ts` chịu trách nhiệm kết nối database sử dụng biến môi trường `MONGODB_URI` (mặc định là `mongodb://127.0.0.1:27017/nhahang`).

### Cách cấu hình môi trường (.env)
File `.env` ở thư mục gốc cần cấu hình các tham số sau:
*   `PORT`: Port chạy server (mặc định 5000).
*   `MONGODB_URI`: Đường dẫn kết nối MongoDB.
*   `JWT_SECRET`: Khóa bí mật ký mã token JWT.
*   `JWT_EXPIRY`: Thời hạn token (mặc định 12h).
*   `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`, `MAIL_FROM`: Cấu hình máy chủ gửi email.
*   `APP_BASE_URL` hoặc `FRONTEND_URL` / `CLIENT_URL`: URL của frontend (mặc định http://localhost:5173) để tạo link trong email.

---

## 2. Danh sách chức năng đã làm

Dưới đây là chi tiết trạng thái từng phân hệ chức năng trong mã nguồn Backend thực tế:

### 2.1. Authentication / Authorization
*   **Trạng thái:** **Hoàn thành**
*   **Files liên quan:** `src/middleware/auth.ts`, `src/routes/authRoutes.ts`, `src/models/PasswordResetToken.ts`, `src/services/emailService.ts`.
*   **Chi tiết API & Nghiệp vụ:**
    *   `POST /api/auth/login`: Hỗ trợ đăng nhập cho cả 3 vai trò:
        1.  `SUPER_ADMIN`: Dùng username hệ thống.
        2.  `RESTAURANT_ADMIN`: Dùng username của admin hoặc email của nhà hàng để tìm kiếm tài khoản.
        3.  `STAFF`: Dùng username nhân viên.
    *   `POST /api/auth/change-password` (Yêu cầu Token): Đổi mật khẩu của người dùng hiện tại dựa trên `req.auth.sub`.
    *   `POST /api/auth/request-password-reset`: Yêu cầu gửi mã OTP (6 chữ số ngẫu nhiên) qua email của nhà hàng để đặt lại mật khẩu admin (hạn 15 phút, lưu vào `PasswordResetToken`).
    *   `POST /api/auth/reset-password`: Đặt lại mật khẩu mới sau khi xác thực email và mã OTP hợp lệ.
*   **Ghi chú:** Cơ chế phân quyền hoạt động tốt bằng middleware JWT, phân biệt quyền rõ ràng qua token payload (`sub`, `role`, `restaurantId`).

### 2.2. User / Customer (Quản lý tài khoản & Khách hàng)
*   **Trạng thái:** **Một phần**
*   **Files liên quan:** `src/models/User.ts`, `src/routes/staffRoutes.ts`.
*   **Chi tiết API & Nghiệp vụ:**
    *   Backend chỉ có thực thể `User` đại diện cho tài khoản quản trị và nhân viên của nhà hàng (`SUPER_ADMIN`, `RESTAURANT_ADMIN`, `STAFF`).
    *   **Không có** thực thể `Customer` (khách hàng gọi món tại bàn được coi là Guest/Public không cần đăng nhập).
    *   **Chưa có** các thuộc tính liên quan tới khách hàng cá nhân (hồ sơ sức khỏe, sở thích ăn kiêng, lịch sử dị ứng, đề xuất cá nhân hóa).

### 2.3. Restaurant (Quản lý Nhà hàng)
*   **Trạng thái:** **Hoàn thành**
*   **Files liên quan:** `src/models/Restaurant.ts`, `src/routes/restaurantRoutes.ts`, `src/models/EmailChangeToken.ts`, `src/models/BankAccountChangeToken.ts`.
*   **Chi tiết API & Nghiệp vụ:**
    *   `GET /api/restaurants`: Lấy danh sách nhà hàng kèm tìm kiếm, lọc theo status (`ACTIVE`, `INACTIVE`), sắp xếp.
    *   `POST /api/restaurants` (Super Admin): Tạo nhà hàng mới + tạo tài khoản Admin nhà hàng + gửi email chào mừng tự động chứa mật khẩu tạm.
    *   `PATCH /api/restaurants/:id` (Super Admin): Cập nhật thông tin chi tiết nhà hàng hoặc trạng thái kích hoạt trực tiếp.
    *   `DELETE /api/restaurants/:id` (Super Admin): Xóa nhà hàng.
    *   `POST /api/restaurants/:id/reset-password` (Super Admin): Đặt lại mật khẩu admin nhà hàng bất kỳ.
    *   `POST /api/restaurants/me/request-email-change` (Restaurant Admin): Yêu cầu OTP để đổi email nhà hàng (gửi mã OTP về email cũ để xác minh).
    *   `POST /api/restaurants/me/request-bank-change` (Restaurant Admin): Yêu cầu OTP để đổi tài khoản ngân hàng nhận tiền (gửi OTP về email hiện tại).
    *   `PATCH /api/restaurants/me` (Restaurant Admin): Cập nhật thông tin nhà hàng của mình. Nếu có thay đổi email hoặc bank account thì **bắt buộc** phải truyền kèm mã OTP tương ứng (`emailChangeOtp` hoặc `bankChangeOtp`) để xác thực.

### 2.4. Category (Danh mục món ăn)
*   **Trạng thái:** **Hoàn thành**
*   **Files liên quan:** `src/models/Category.ts`, `src/routes/categoryRoutes.ts`.
*   **Chi tiết API & Nghiệp vụ:**
    *   `GET /api/categories?restaurantId=...`: Lấy danh sách danh mục của nhà hàng (Public).
    *   `POST /api/categories` (Restaurant Admin): Thêm danh mục mới (tên duy nhất trong nhà hàng).
    *   `PATCH /api/categories/:id` (Restaurant Admin): Sửa tên danh mục.
    *   `DELETE /api/categories/:id` (Restaurant Admin): Xóa danh mục.
*   **Code Smell cần lưu ý:** Schema `MenuItem` lưu trường `category` dưới dạng một **string thuần túy** thay vì tham chiếu ObjectId của `Category`. Điều này dẫn đến:
    1.  Khi cập nhật tên danh mục ở bảng `Category`, các món ăn thuộc danh mục đó **không được tự động cập nhật tên danh mục mới** (dữ liệu bị lệch pha).
    2.  Khi xóa danh mục ở bảng `Category`, các món ăn vẫn giữ giá trị string danh mục cũ, tạo ra dữ liệu mồ côi.

### 2.5. Food / Dish (Món ăn)
*   **Trạng thái:** **Hoàn thành**
*   **Files liên quan:** `src/models/MenuItem.ts`, `src/routes/menuRoutes.ts`.
*   **Chi tiết API & Nghiệp vụ:**
    *   `GET /api/menu?restaurantId=...&includeUnavailable=true`: Lấy menu món ăn. Nếu là khách hàng (`includeUnavailable` không truyền hoặc = `false`), chỉ lấy các món có trạng thái `available = true`.
    *   `POST /api/menu` (Restaurant Admin): Thêm món mới (yêu cầu name, price, category).
    *   `PATCH /api/menu/:id` (Restaurant Admin): Cập nhật thông tin món ăn (name, price, description, category, imageUrl, available).
    *   `DELETE /api/menu/:id` (Restaurant Admin): Xóa món ăn.

### 2.6. Table / QR Code
*   **Trạng thái:** **Một phần**
*   **Files liên quan:** `src/models/Table.ts`, `src/routes/tableRoutes.ts`, `src/routes/restaurantRoutes.ts` (API vietqr).
*   **Chi tiết API & Nghiệp vụ:**
    *   `GET /api/tables?restaurantId=...`: Lấy danh sách bàn ăn.
    *   `POST /api/tables` (Restaurant Admin): Lưu/Đồng bộ số bàn ăn (sử dụng cơ chế `findOneAndUpdate` với `upsert: true`).
    *   `POST /api/restaurants/generate-qr`: Nhận thông tin ngân hàng, số tài khoản, tên và số tiền để gọi qua Livewire API của `vietqr.co` tạo ảnh QR thanh toán.
*   **Thiếu hụt:**
    *   Chưa có tính năng sinh mã QR định danh bàn ăn tự động chứa link đặt món (ví dụ: `http://domain.com/#/order?r=...&t=...`). Giao diện Admin hiện tại chỉ có lưu số bàn tĩnh chứ chưa hiển thị ảnh mã QR để nhà hàng in ra dán tại bàn.
    *   API gọi `vietqr.co` sử dụng cơ chế Livewire payload phức tạp, dễ bị lỗi nếu bên thứ ba thay đổi cấu trúc internal. Nên chuyển sang API chuẩn `https://api.vietqr.io` hoặc `img.vietqr.io`.

### 2.7. Order (Đặt món & Quản lý đơn hàng)
*   **Trạng thái:** **Một phần / Có lỗi logic nghiêm trọng**
*   **Files liên quan:** `src/models/Order.ts`, `src/routes/orderRoutes.ts`, `src/routes/staffRoutes.ts`.
*   **Chi tiết API & Nghiệp vụ:**
    *   `POST /api/orders` (Public): Khách hàng đặt món (truyền restaurantId, tableNumber, items, note, customerName). Tính toán `totalAmount` tự động, mặc định trạng thái `PENDING`.
    *   `GET /api/orders?restaurantId=...&tableNumber=...` (Public): Khách hàng xem lịch sử đơn hàng tại bàn của mình.
    *   `GET /api/staff/orders` (Admin/Staff): Nhân viên xem toàn bộ đơn hàng của nhà hàng (giới hạn 100 đơn mới nhất).
    *   `PATCH /api/staff/orders/:id` (Admin/Staff): Xác nhận đơn hàng, thay đổi trạng thái (`PENDING` -> `CONFIRMED` -> `SERVED` -> `COMPLETED` / `CANCELLED`). Ghi nhận thông tin người thực hiện cập nhật (`confirmedByName`, `updatedByName`). Hỗ trợ lưu hình thức thanh toán khi hoàn thành đơn (`CASH` hoặc `BANK_TRANSFER`).
*   **Lỗi logic nghiêm trọng (Business Block):**
    Trong `orderRoutes.ts`, khi khách hàng gửi đơn hàng mới, hệ thống kiểm tra xem bàn ăn đó có đang hoạt động hay không:
    ```typescript
    const activeOrders = await Order.find({
      restaurantId: new mongoose.Types.ObjectId(restaurantId),
      tableNumber,
      status: { $in: [OrderStatus.PENDING, OrderStatus.CONFIRMED, OrderStatus.SERVED] }
    });
    if (activeOrders.length > 0) {
      return res.status(400).json({ message: "Bàn này đã có khách, vui lòng chọn bàn khác" });
    }
    ```
    Logic này **ngăn chặn hoàn toàn** việc khách hàng tại bàn gọi thêm món (gọi món đợt 2, đợt 3...) khi món cũ chưa được thanh toán/hoàn thành. Trong thực tế, khách ăn tại bàn liên tục thêm món mới. Cơ chế chặn này là một điểm trừ lớn về trải nghiệm thực tế.

### 2.8. Cart (Giỏ hàng)
*   **Trạng thái:** **Chưa làm**
*   **Ghi chú:** Backend không lưu thông tin giỏ hàng (Cart). Giỏ hàng được quản lý 100% ở phía client (Local State / LocalStorage), điều này hoàn toàn hợp lý và phổ biến đối với các ứng dụng đặt món QR.

### 2.9. Payment (Thanh toán)
*   **Trạng thái:** **Một phần**
*   **Files liên quan:** `src/models/Order.ts`, `src/routes/restaurantRoutes.ts`.
*   **Chi tiết API & Nghiệp vụ:**
    *   Đơn hàng có lưu trường `paymentMethod` (`CASH`, `BANK_TRANSFER`).
    *   Có API sinh mã QR thanh toán động qua VietQR.
    *   **Thiếu hụt:** Chưa có tích hợp cổng thanh toán trực tuyến (VNPay, PayOS, Stripe) để tự động hóa việc xác thực giao dịch qua Webhook. Nhân viên hiện tại vẫn phải xác nhận thanh toán thủ công trên giao diện khi khách chuyển khoản xong.

### 2.10. Dashboard & Statistics (Thống kê doanh thu)
*   **Trạng thái:** **Hoàn thành**
*   **Files liên quan:** `src/routes/restaurantRoutes.ts` (API me/stats, stats/overview, :id/stats/revenue).
*   **Chi tiết API & Nghiệp vụ:**
    *   `GET /api/restaurants/stats/overview` (Super Admin): Xem tổng số nhà hàng hoạt động/tạm dừng và Top 5 nhà hàng doanh thu cao nhất.
    *   `GET /api/restaurants/:id/stats/revenue` (Super Admin): Lấy doanh thu chi tiết của nhà hàng cụ thể theo ngày.
    *   `GET /api/restaurants/me/stats` (Restaurant Admin): Thống kê toàn diện của nhà hàng đang đăng nhập, bao gồm:
        *   Doanh thu, số lượng đơn hàng, giá trị đơn hàng trung bình kèm theo tỷ lệ tăng trưởng phần trăm so với chu kỳ trước (hôm qua, tuần trước, tháng trước).
        *   Tỷ lệ hủy đơn, thời gian chế biến trung bình, số khách hàng độc nhất, giờ cao điểm.
        *   Doanh thu theo ngày (vẽ biểu đồ đường), doanh thu theo giờ (vẽ biểu đồ cột).
        *   Top 10 món ăn bán chạy nhất (KPI bán chạy).
        *   Doanh thu theo danh mục món ăn (biểu đồ tròn).
        *   Doanh thu theo bàn ăn (top bàn mang lại nhiều tiền nhất).
        *   Phân bố đơn hàng theo trạng thái và danh sách các đơn hàng có giá trị lớn nhất.
*   **Ghi chú:** Phần tính toán thống kê viết cực kỳ chi tiết, tối ưu hóa tốt và trả về cấu trúc khớp hoàn hảo với biểu đồ Recharts của FE.

### 2.11. Upload Image (Tải ảnh lên)
*   **Trạng thái:** **Chưa làm**
*   **Ghi chú:** Backend chưa có cấu hình upload hình ảnh (không dùng Multer, Cloudinary hay lưu local). Các API thêm/sửa món ăn bắt buộc phải điền link ảnh tĩnh (`imageUrl`) dưới dạng string có sẵn.

### 2.12. Admin / Staff Role (Phân quyền nhân viên)
*   **Trạng thái:** **Hoàn thành**
*   **Files liên quan:** `src/models/User.ts`, `src/routes/staffRoutes.ts`, `src/middleware/auth.ts`.
*   **Chi tiết API & Nghiệp vụ:**
    *   `GET /api/staff`: Lấy danh sách nhân viên của nhà hàng (Chỉ Admin nhà hàng).
    *   `POST /api/staff`: Tạo tài khoản nhân viên (Chỉ Admin nhà hàng).
    *   `PATCH /api/staff/:id`: Sửa thông tin nhân viên, đổi mật khẩu (Chỉ Admin nhà hàng).
    *   `PATCH /api/staff/:id/toggle-active`: Khóa/Mở khóa tài khoản nhân viên. Tài khoản bị khóa sẽ không thể đăng nhập (`isActive: false`).
    *   Middleware kiểm soát nghiêm ngặt: Nhân viên (`STAFF`) chỉ được xem đơn hàng (`GET /api/staff/orders`) và chuyển trạng thái xác nhận đơn hàng (`PENDING` -> `CONFIRMED`). Nhân viên không được phép đổi trạng thái hoàn thành thanh toán hay hủy đơn (phân quyền rất an toàn).

### 2.13. Phân hệ Dinh dưỡng, Cảnh báo dị ứng, Chỉ số Xanh (QDish core)
*   **Nutrition / Calories / Macro:** **Chưa làm** (Chưa thấy trong code).
*   **Allergen warning (Cảnh báo dị ứng):** **Chưa làm** (Chưa thấy trong code).
*   **Eco-friendly / Carbon Footprint:** **Chưa làm** (Chưa thấy trong code).
*   **User Health Profile & Gợi ý món:** **Chưa làm** (Chưa thấy trong code).

---

## 3. Danh sách API hiện có

Dưới đây là bảng tổng hợp chi tiết toàn bộ hệ thống API hiện có trong source code `QR_FOOD_ORDER_BE`:

| Module | Endpoint | Method | Chức năng | Auth Required | Role Required | Status hiện tại | FE Page/Component có thể dùng |
| :--- | :--- | :--- | :--- | :---: | :---: | :---: | :--- |
| **Auth** | `/api/auth/login` | `POST` | Đăng nhập hệ thống (mọi vai trò) | Không | - | Hoạt động tốt | `Login.tsx` |
| **Auth** | `/api/auth/change-password` | `POST` | Đổi mật khẩu tài khoản hiện tại | Có | - | Hoạt động tốt | `RestaurantDashboard.tsx` (Tab Profile) |
| **Auth** | `/api/auth/request-password-reset` | `POST` | Yêu cầu gửi OTP reset mật khẩu admin qua Email | Không | - | Hoạt động tốt | `Login.tsx` (Forgot Password) |
| **Auth** | `/api/auth/reset-password` | `POST` | Đặt lại mật khẩu bằng mã OTP nhận qua Email | Không | - | Hoạt động tốt | `ResetPassword.tsx` |
| **Category**| `/api/categories` | `GET` | Lấy danh sách danh mục món ăn | Không | - | Hoạt động tốt | `CustomerView.tsx`, `RestaurantDashboard.tsx` |
| **Category**| `/api/categories` | `POST` | Tạo danh mục món ăn mới | Có | `RESTAURANT_ADMIN` | Hoạt động tốt | `RestaurantDashboard.tsx` (Quản lý Menu) |
| **Category**| `/api/categories/:id` | `PATCH`| Cập nhật tên danh mục món ăn | Có | `RESTAURANT_ADMIN` | Hoạt động tốt | `RestaurantDashboard.tsx` (Quản lý Menu) |
| **Category**| `/api/categories/:id` | `DELETE`| Xóa danh mục món ăn | Có | `RESTAURANT_ADMIN` | Hoạt động tốt | `RestaurantDashboard.tsx` (Quản lý Menu) |
| **Menu** | `/api/menu` | `GET` | Lấy danh sách món ăn của nhà hàng | Không | - | Hoạt động tốt | `CustomerView.tsx`, `RestaurantDashboard.tsx` |
| **Menu** | `/api/menu` | `POST` | Thêm món ăn mới vào thực đơn | Có | `RESTAURANT_ADMIN` | Hoạt động tốt | `RestaurantDashboard.tsx` (Quản lý Menu) |
| **Menu** | `/api/menu/:id` | `PATCH`| Cập nhật thông tin chi tiết món ăn | Có | `RESTAURANT_ADMIN` | Hoạt động tốt | `RestaurantDashboard.tsx` (Quản lý Menu) |
| **Menu** | `/api/menu/:id` | `DELETE`| Xóa món ăn khỏi thực đơn | Có | `RESTAURANT_ADMIN` | Hoạt động tốt | `RestaurantDashboard.tsx` (Quản lý Menu) |
| **Order** | `/api/orders` | `POST` | Khách hàng đặt món từ bàn ăn | Không | - | **Lỗi chặn gọi thêm món** | `CustomerView.tsx` (Đặt món) |
| **Order** | `/api/orders` | `GET` | Khách hàng xem lịch sử đơn hàng của bàn | Không | - | Chưa được FE gọi | Giao diện lịch sử đơn của khách (Chưa có) |
| **Restaurant**| `/api/restaurants/stats/overview`| `GET`| Lấy thống kê tổng quan hệ thống SaaS | Có | `SUPER_ADMIN` | Hoạt động tốt | `SuperAdminDashboard.tsx` (Overview Card) |
| **Restaurant**| `/api/restaurants/:id/stats/revenue`| `GET`| Thống kê doanh thu một nhà hàng cụ thể | Có | `SUPER_ADMIN` | Hoạt động tốt | `SuperAdminDashboard.tsx` (Chi tiết nhà hàng) |
| **Restaurant**| `/api/restaurants` | `GET` | Lấy danh sách nhà hàng (tìm kiếm, lọc) | Không | - | Hoạt động tốt | `SuperAdminDashboard.tsx`, `App.tsx` |
| **Restaurant**| `/api/restaurants` | `POST` | Tạo nhà hàng + tạo Admin + gửi Email chào mừng | Không | - | Hoạt động tốt | `SuperAdminDashboard.tsx` (Thêm nhà hàng) |
| **Restaurant**| `/api/restaurants/me/request-email-change`| `POST`| Yêu cầu OTP để đổi email nhà hàng | Có | `RESTAURANT_ADMIN` | Hoạt động tốt | `RestaurantDashboard.tsx` (Profile) |
| **Restaurant**| `/api/restaurants/me/request-bank-change`| `POST`| Yêu cầu OTP để đổi ngân hàng nhận tiền | Có | `RESTAURANT_ADMIN` | Hoạt động tốt | `RestaurantDashboard.tsx` (Profile) |
| **Restaurant**| `/api/restaurants/me` | `PATCH`| Cập nhật thông tin nhà hàng (yêu cầu OTP nếu đổi Email/Bank) | Có | `RESTAURANT_ADMIN` | Hoạt động tốt | `RestaurantDashboard.tsx` (Profile) |
| **Restaurant**| `/api/restaurants/:id/request-email-change`| `POST`| Yêu cầu OTP đổi email (Super Admin kích hoạt) | Có | `SUPER_ADMIN` | Hoạt động tốt | `SuperAdminDashboard.tsx` |
| **Restaurant**| `/api/restaurants/:id` | `PATCH`| Super Admin cập nhật trực tiếp thông tin nhà hàng bất kỳ | Có | `SUPER_ADMIN` | Hoạt động tốt | `SuperAdminDashboard.tsx` |
| **Restaurant**| `/api/restaurants/:id` | `DELETE`| Xóa nhà hàng khỏi hệ thống | Có | `SUPER_ADMIN` | Hoạt động tốt | `SuperAdminDashboard.tsx` |
| **Restaurant**| `/api/restaurants/:id/reset-password`| `POST`| Super Admin khôi phục mật khẩu cho nhà hàng | Có | `SUPER_ADMIN` | Hoạt động tốt | `SuperAdminDashboard.tsx` |
| **Restaurant**| `/api/restaurants/generate-qr`| `POST`| Gọi API tạo ảnh QR thanh toán VietQR | Không | - | Cần test độ ổn định | `Invoice.tsx` (Thanh toán QR) |
| **Restaurant**| `/api/restaurants/me/stats` | `GET` | Thống kê doanh thu, KPI nhà hàng chi tiết | Có | `RESTAURANT_ADMIN`| Hoạt động tốt | `RestaurantDashboard.tsx` (Thống kê) |
| **Staff** | `/api/staff` | `GET` | Lấy danh sách tài khoản nhân viên nhà hàng | Có | `RESTAURANT_ADMIN`| Hoạt động tốt | `RestaurantDashboard.tsx` (Nhân viên) |
| **Staff** | `/api/staff` | `POST` | Tạo tài khoản nhân viên mới | Có | `RESTAURANT_ADMIN`| Hoạt động tốt | `RestaurantDashboard.tsx` (Thêm NV) |
| **Staff** | `/api/staff/orders` | `GET` | Lấy danh sách đơn hàng để xử lý (real-time) | Có | `STAFF`, `RESTAURANT_ADMIN`| Hoạt động tốt | `RestaurantDashboard.tsx` (Đơn), `StaffDashboard.tsx` |
| **Staff** | `/api/staff/orders/:id`| `PATCH`| Cập nhật trạng thái đơn (Staff chỉ được phép confirm) | Có | `STAFF`, `RESTAURANT_ADMIN`| Hoạt động tốt | `RestaurantDashboard.tsx`, `StaffDashboard.tsx` |
| **Staff** | `/api/staff/:id/toggle-active`| `PATCH`| Khóa hoặc kích hoạt lại tài khoản nhân viên | Có | `RESTAURANT_ADMIN`| Hoạt động tốt | `RestaurantDashboard.tsx` (Nhân viên) |
| **Staff** | `/api/staff/:id` | `PATCH`| Cập nhật thông tin/mật khẩu tài khoản nhân viên | Có | `RESTAURANT_ADMIN`| Hoạt động tốt | `RestaurantDashboard.tsx` (Sửa NV) |
| **Table** | `/api/tables` | `GET` | Lấy danh sách bàn ăn nhà hàng | Không | - | Hoạt động tốt | `RestaurantDashboard.tsx` (Bàn ăn) |
| **Table** | `/api/tables` | `POST` | Lưu và đồng bộ số bàn ăn khi sinh mã QR | Có | `RESTAURANT_ADMIN`| Hoạt động tốt | `RestaurantDashboard.tsx` (Bàn ăn) |

---

## 4. Requirement đã hoàn thành đối chiếu với dự án QDish

**Định hướng dự án QDISH:**
> QDISH là hệ sinh thái menu điện tử thông minh bằng QR code, hiển thị menu điện tử, dữ liệu dinh dưỡng, calories, macro, cảnh báo dị ứng, eco score, carbon footprint, hồ sơ sức khỏe người dùng, gợi ý món phù hợp và dashboard nhà hàng.

Đối chiếu thực tế source code Backend hiện tại với định hướng trên:

### 4.1. Requirements đã làm xong
1.  **Menu điện tử công khai:** API hiển thị danh mục và thực đơn hoạt động hoàn thiện, lọc các món hết một cách thông minh cho khách hàng.
2.  **Hệ thống đặt món bằng QR:** Cho phép khách hàng gửi đơn đặt món kèm theo ghi chú và tên trực tiếp lên hệ thống chế biến của nhà hàng.
3.  **Dashboard nhà hàng:** Hoàn thành xuất sắc. Phân tích chi tiết doanh số, thời gian chế biến, hiệu suất món ăn bán chạy, top bàn ăn mang lại doanh thu cao.
4.  **Hệ thống SaaS quản lý nhà hàng:** Super Admin tạo nhà hàng, gửi thông tin tài khoản qua email tự động.
5.  **Cơ chế OTP bảo mật cao:** Đổi email, đổi tài khoản ngân hàng nhận tiền đều yêu cầu xác thực OTP gửi qua email cực kỳ chuyên nghiệp.

### 4.2. Requirements mới làm một phần
1.  **Thanh toán điện tử:** Mới chỉ cung cấp API sinh mã QR tĩnh theo VietQR, chưa hỗ trợ kiểm tra trạng thái thanh toán tự động qua Webhook ngân hàng.
2.  **Quản lý bàn ăn bằng QR:** Đã có danh sách lưu số bàn, chưa hỗ trợ sinh mã QR động chứa URL đặt món để in ấn trực tiếp từ giao diện Admin.

### 4.3. Requirements chưa có (Trống hoàn toàn trong BE)
1.  **Dữ liệu dinh dưỡng món ăn:** Chưa có các trường lưu Calories, Protein, Carb, Fat, Ingredients (Thành phần) trong cơ sở dữ liệu `MenuItem`.
2.  **Nhãn sinh thái & EcoScore:** Chưa hỗ trợ tính toán hay lưu trữ chỉ số Carbon Footprint hay nhãn Eco-friendly cho các món ăn.
3.  **Cảnh báo dị ứng:** Chưa định nghĩa các thành phần dễ gây dị ứng (Allergens) trên món ăn để hiển thị cảnh báo cho khách.
4.  **Hồ sơ sức khỏe người dùng (User Health Profile):** Khách hàng chưa có tài khoản lưu trữ cân nặng, chiều cao, mục tiêu dinh dưỡng (dietary goals), danh sách dị ứng.
5.  **Thuật toán gợi ý món ăn:** Chưa có logic đề xuất món ăn phù hợp với thể trạng hoặc mục tiêu sức khỏe của người dùng.

### 4.4. Requirements BE có nhưng FE chưa khai thác
1.  **API lịch sử đơn hàng tại bàn của khách (`GET /api/orders?restaurantId=...&tableNumber=...`):**
    *   **Thực tế ở BE:** Có endpoint này để khách hàng tải lại toàn bộ các đơn hàng đã đặt của bàn mình.
    *   **Thực tế ở FE mẫu:** `FEMAU/App.tsx` chỉ lưu trạng thái đơn hàng của khách bằng local state. Khi khách tải lại trang (refresh), danh sách đơn hàng đã đặt sẽ biến mất (chỉ hiển thị các đơn mới đặt trong session đó). FE chưa hề gọi API này để phục hồi đơn hàng cũ của bàn ăn.

### 4.5. Requirements FE cần nhưng BE chưa hỗ trợ
1.  **Upload hình ảnh trực tiếp:**
    *   **Thực tế ở FE mẫu:** Có giao diện chọn ảnh cho món ăn.
    *   **Thực tế ở BE:** Chưa hỗ trợ API nhận file ảnh (Multer/Cloudinary). Admin phải dán thủ công đường dẫn URL ảnh tĩnh có sẵn.
2.  **Đặt nhiều đợt món liên tiếp tại bàn:**
    *   **Thực tế ở FE mẫu:** Khách hàng có nhu cầu bấm đặt thêm món liên tục.
    *   **Thực tế ở BE:** Chặn hoàn toàn nếu bàn ăn đang có đơn hàng chưa hoàn thành (`PENDING`, `CONFIRMED`, `SERVED`).

---

## 5. Đối chiếu chi tiết với FE mẫu (FEMAU)

Đọc mã nguồn `FEMAU` cho thấy các màn hình đang khớp hoặc chưa khớp với Backend hiện tại:

1.  **Màn hình Login / Forgot Password (`Login.tsx`, `ResetPassword.tsx`):**
    *   *Khớp nối:* Tích hợp hoàn hảo với API `/api/auth/login` (nhận JWT token lưu vào localStorage và giải mã JWT lấy Role). Khớp hoàn toàn với API đặt lại mật khẩu nhận OTP qua email.
2.  **Màn hình Super Admin (`SuperAdminDashboard.tsx`):**
    *   *Khớp nối:* Sử dụng tốt các API lấy danh sách nhà hàng, kích hoạt/khóa nhà hàng, reset mật khẩu nhà hàng, thống kê tổng quan hệ thống SaaS và vẽ biểu đồ doanh thu từng nhà hàng rất chính xác.
3.  **Màn hình Restaurant Admin (`RestaurantDashboard.tsx`):**
    *   *Khớp nối:*
        *   Tab Thống kê gọi trực tiếp `/api/restaurants/me/stats` và hiển thị tất cả KPI, biểu đồ Recharts (doanh thu theo ngày, giờ, danh mục, top món ăn bán chạy).
        *   Tab Thực đơn thực hiện tốt CRUD món ăn và danh mục qua API.
        *   Tab Profile lấy thông tin và hỗ trợ gửi OTP, cập nhật thông tin ngân hàng rất khớp.
4.  **Màn hình Staff (`StaffDashboard.tsx`):**
    *   *Khớp nối:* Gọi API `/api/staff/orders` thực hiện cơ chế **Polling (refresh mỗi 5 giây)** để tự động cập nhật danh sách đơn hàng cần chuẩn bị và cho phép chuyển trạng thái đơn hàng.
5.  **Màn hình Khách hàng (`CustomerView.tsx`):**
    *   *Khớp nối:* Tải dữ liệu menu của nhà hàng theo `restaurantId` từ URL Hash (`#/order?r=...&t=...`). Gửi đơn đặt món thành công lên database.
    *   *Lỗi không khớp:*
        *   **Thiếu đồng bộ đơn cũ:** Khi tải lại trang, các đơn hàng đang chuẩn bị của bàn biến mất vì FE không gọi API lịch sử đơn hàng theo bàn.
        *   **Không thể gọi thêm món:** Gây lỗi Alert trên FE khi khách hàng cố tình gọi thêm món đợt hai, do BE chặn đơn hàng hoạt động tại bàn.

---

## 6. Gap Analysis (Phân tích khoảng cách)

Dưới đây là bảng tổng hợp các khoảng trống (gaps) kỹ thuật và chức năng giữa Frontend mẫu và Backend hiện tại, xếp theo mức độ ưu tiên xử lý:

| Tính năng | Frontend (FE) cần gì | Backend (BE) hiện có gì | Phần còn thiếu (Gap) | Mức độ ưu tiên | Đề xuất hướng xử lý |
| :--- | :--- | :--- | :--- | :---: | :--- |
| **Dinh dưỡng & Calo** | Hiển thị lượng Calo, Carb, Protein, Fat và chỉ số Macro của món ăn | Chưa có trường thông tin dinh dưỡng trong Schema và API | Thiếu các trường dữ liệu dinh dưỡng trong `MenuItemSchema` và API CRUD món ăn | **High** | Cập nhật `MenuItem.ts` thêm sub-document `nutrition`: `{ calories, protein, carb, fat }`. Cập nhật route thêm/sửa món ăn nhận các trường này. |
| **Allergen & Health Warning** | Hiển thị nhãn cảnh báo dị ứng (đậu phộng, hải sản...) và bộ lọc món ăn theo hồ sơ sức khỏe | Chưa có trường lưu trữ thành phần dị ứng trên món ăn | Thiếu trường `allergens` (array string) trong món ăn và logic kiểm tra cảnh báo | **Medium** | Thêm trường `allergens` (mảng chuỗi) và các nhãn sức khỏe (ví dụ: `isVegan`, `isGlutenFree`) vào Schema món ăn. |
| **Eco Score & Carbon** | Hiển thị điểm số thân thiện môi trường và lượng phát thải khí nhà kính (CO2) | Chưa có thuộc tính liên quan trong database | Thiếu trường `ecoScore` (số) và `carbonFootprint` (số) trên món ăn | **Medium** | Thêm trường `ecoScore` và `carbonFootprint` vào Schema món ăn. Hỗ trợ hiển thị nhãn xanh trên giao diện menu. |
| **Hồ sơ sức khỏe & Đề xuất** | Khách hàng khai báo chỉ số cơ thể, mục tiêu calo, dị ứng để nhận gợi ý món ăn | Chưa có thực thể lưu thông tin khách hàng hay thuật toán đề xuất | Thiếu Schema `CustomerProfile` và thuật toán đối khớp dinh dưỡng với menu | **High** | Tạo Schema mới `CustomerProfile` (chiều cao, cân nặng, dị ứng, mục tiêu). Viết API `/api/recommendations` so khớp điểm dinh dưỡng món ăn với thể trạng khách hàng để đề xuất món tối ưu. |
| **Gọi thêm món tại bàn** | Khách hàng tại bàn gọi món nhiều đợt liên tục trong cùng một bữa ăn | Chặn không cho tạo đơn mới nếu bàn ăn đang có đơn hàng chưa hoàn thành | Logic kiểm tra đơn hàng đang hoạt động bị quá cứng nhắc | **High** | Thay đổi logic kiểm tra ở `orderRoutes.ts`. Cho phép đặt thêm món nếu đơn hàng trước đó chưa thanh toán (gộp đơn hoặc lưu nhiều đơn con cho cùng một session bàn ăn). |
| **Sinh mã QR bàn ăn** | Giao diện in mã QR bàn ăn để dán tại bàn của nhà hàng | Mới chỉ lưu số bàn ăn, chưa có sinh QR code chứa link bàn ăn tự động | Chưa có thư viện sinh ảnh mã QR đặt món trực tiếp từ Admin | **High** | Tích hợp thư viện sinh QR code (như `qrcode` hoặc gọi API ảnh bên ngoài) tự động sinh mã QR chứa link đặt món: `https://qdish.com/#/order?r={restaurantId}&t={tableNumber}`. |
| **Upload hình ảnh** | Giao diện quản lý món ăn cho phép tải ảnh món từ máy tính lên | Bắt buộc truyền link ảnh tĩnh dạng string, chưa hỗ trợ upload file | Thiếu API upload file ảnh món ăn và lưu trữ đám mây | **High** | Cài đặt thư viện `multer` trong BE để nhận file, tích hợp Cloudinary hoặc lưu trữ local để lưu file ảnh và trả về url động khi thêm/sửa món ăn. |
| **Webhook thanh toán** | Tự động cập nhật đơn hàng thành `COMPLETED` khi khách hàng chuyển khoản VietQR thành công | Mới chỉ hiển thị mã QR thanh toán tĩnh, chưa kiểm tra kết quả giao dịch | Thiếu Webhook nhận thông báo biến động số dư tài khoản ngân hàng | **Medium** | Tích hợp Webhook của bên dịch vụ ngân hàng thanh toán (ví dụ: Casso, PayOS) để tự động hóa trạng thái đơn hàng khi giao dịch thành công. |

---

## 7. Đề xuất Roadmap hoàn thiện Backend (QDish)

Để đưa hệ thống **QDish** đạt trạng thái hoạt động toàn diện và thông minh, lộ trình phát triển Backend nên được chia làm 6 giai đoạn rõ ràng:

### Phase 1: Core QR Menu & Đồng bộ Bàn ăn (Ưu tiên số 1)
*   **Mục tiêu:** Ổn định các tính năng cốt lõi của QR Menu, giải quyết triệt để lỗi logic gọi món và quản lý bàn ăn.
*   **Nhiệm vụ:**
    1.  Sửa logic `POST /api/orders` ở Backend: Cho phép khách đặt món nhiều lần trên một bàn ăn mà không bị chặn, lưu trữ thông tin phiên ăn uống của bàn.
    2.  Hỗ trợ API khôi phục lịch sử đơn hàng tại bàn của khách (`GET /api/orders?restaurantId=...&tableNumber=...`) để đồng bộ trạng thái đơn hàng thực tế trên giao diện Frontend của khách khi họ tải lại trang.
    3.  Tích hợp API/Thư viện sinh mã QR định danh bàn ăn tự động chứa link đặt món công khai.
    4.  Xây dựng API upload ảnh món ăn tích hợp Cloudinary/Multer thay vì bắt buộc nhập link ảnh thủ công.

### Phase 2: Ordering Flow & Tích hợp Thanh toán tự động
*   **Mục tiêu:** Tối ưu quy trình đặt món của khách hàng và tự động hóa quy trình thanh toán cho nhà hàng.
*   **Nhiệm vụ:**
    1.  Tích hợp cổng thanh toán trực tuyến thực tế (đề xuất cổng **PayOS** hoặc giải pháp quét biến động số dư **Casso**).
    2.  Viết API Webhook tiếp nhận thông báo thanh toán thành công để tự động chuyển trạng thái đơn hàng sang `COMPLETED` mà không cần nhân viên bấm tay.
    3.  Hỗ trợ tính năng in hóa đơn trực tiếp hoặc tạo file hóa đơn PDF chuyên nghiệp gửi cho khách.

### Phase 3: Nutrition Intelligence (Trí tuệ Dinh dưỡng)
*   **Mục tiêu:** Xây dựng nền tảng cơ sở dữ liệu về chỉ số dinh dưỡng cho món ăn (trọng tâm của QDish).
*   **Nhiệm vụ:**
    1.  Cập nhật cơ sở dữ liệu `MenuItem` để lưu thông tin chi tiết: Lượng Calo, thành phần đa lượng (Carb, Protein, Fat), thành phần nguyên liệu chính.
    2.  Viết API tính toán điểm dinh dưỡng hoặc phân loại món ăn (Ví dụ: giàu đạm, ít béo, thích hợp ăn kiêng Keto...).
    3.  Cập nhật API CRUD thực đơn của Admin để quản lý các chỉ số này một cách dễ dàng.

### Phase 4: Personalization & Recommendation (Cá nhân hóa người dùng)
*   **Mục tiêu:** Kết nối hồ sơ sức khỏe khách hàng để đưa ra cảnh báo dị ứng và gợi ý món ăn thông minh.
*   **Nhiệm vụ:**
    1.  Tạo Schema mới lưu trữ Hồ sơ sức khỏe khách hàng Guest (lưu tạm thời ở Client hoặc cho phép đăng ký tài khoản Khách hàng).
    2.  Thiết lập danh sách thành phần dị ứng (`allergens`) cho từng món ăn.
    3.  Viết thuật toán gợi ý món ăn: Dựa trên mục tiêu Calo hàng ngày của khách hàng hoặc cảnh báo đỏ nếu món ăn chứa thành phần gây dị ứng đã khai báo trong hồ sơ sức khỏe của khách.

### Phase 5: Green / Eco Feature (Tính năng Xanh)
*   **Mục tiêu:** Tích hợp các chỉ số thân thiện môi trường cho món ăn.
*   **Nhiệm vụ:**
    1.  Bổ sung chỉ số Eco Score (Đánh giá mức độ bền vững của nguyên liệu) và chỉ số Carbon Footprint (Lượng khí thải CO2 ước tính trong quá trình sản xuất món ăn).
    2.  Thiết lập các nhãn phân loại: "Món ăn Xanh", "Nguyên liệu hữu cơ địa phương", "Bao bì thân thiện môi trường" để kích thích xu hướng tiêu dùng bền vững của khách hàng.

### Phase 6: Admin / SaaS Premium Features
*   **Mục tiêu:** Thương mại hóa hệ thống SaaS, hỗ trợ quản lý chuỗi chi nhánh và tối ưu báo cáo nâng cao.
*   **Nhiệm vụ:**
    1.  Xây dựng tính năng quản lý chi nhánh nhà hàng (Multi-branch management).
    2.  Quản lý đăng ký gói cước sử dụng dịch vụ của nhà hàng (SaaS Subscription với cổng thanh toán PayOS).
    3.  Tích hợp các báo cáo thống kê sâu hơn bằng AI (dự báo lượng nguyên liệu cần mua dựa trên lịch sử doanh thu ngày cao điểm).

---

## 8. Checklist cuối cùng đánh giá mức độ sẵn sàng

Dưới đây là bảng checklist đánh giá tổng quan mức độ hoàn thiện của hệ thống backend hiện tại:

- [x] **Backend chạy được chưa?** -> Đã chạy ổn định cục bộ, kết nối DB MongoDB thành công, hỗ trợ hot-reload tốt.
- [x] **Database schema ổn chưa?** -> Schema tổ chức cơ bản tốt cho nghiệp vụ nhà hàng truyền thống. Tuy nhiên, cần tái cấu trúc trường danh mục (`category`) của `MenuItem` thành tham chiếu ObjectId thay vì lưu text tĩnh và bổ sung gấp các trường chỉ số dinh dưỡng/chỉ số xanh.
- [x] **Xác thực (Auth) ổn chưa?** -> Rất tốt, phân quyền rõ ràng qua token JWT, hỗ trợ đổi mật khẩu và reset mật khẩu bằng mã OTP chuyên nghiệp gửi qua email thực tế.
- [x] **API public menu ổn chưa?** -> Hoạt động tốt, hỗ trợ ẩn các món hết hàng tự động cho khách.
- [/] **API đặt món (Order) ổn chưa?** -> Đặt món gửi lên tốt, gửi email thông báo đơn mới về cho chủ quán tốt. **Tuy nhiên cần sửa ngay lỗi chặn gọi thêm món tại bàn ăn**.
- [x] **API thống kê (Dashboard) ổn chưa?** -> Cực kỳ chi tiết, tính toán đầy đủ các chỉ số nghiệp vụ nhà hàng (giờ cao điểm, tăng trưởng, top món chạy, top bàn mang lại tiền).
- [ ] **API dinh dưỡng (Nutrition) đủ chưa?** -> Chưa có bất kỳ API nào, cần thiết kế và xây dựng mới hoàn toàn.
- [ ] **API hồ sơ sức khỏe (Health Profile) đủ chưa?** -> Chưa có, cần xây dựng mới hoàn toàn.
- [ ] **Có Swagger / Postman Collection chưa?** -> Hiện chưa có file tài liệu API chính thức trong project, giao tiếp qua xem code Router. Cần bổ sung tài liệu hướng dẫn API Swagger.
- [ ] **FE FEMAU có thể tích hợp ngay chưa?** -> Các tính năng cơ bản như Đăng nhập, Thống kê dashboard, CRUD thực đơn và Xử lý đơn hàng đã tích hợp rất khớp. Tuy nhiên, tính năng đặt món của khách bị lỗi chặn đặt thêm và chưa tích hợp các màn hình chỉ số dinh dưỡng/nhãn xanh.

---

### Kết luận
Mã nguồn Backend hiện tại đã hoàn thiện rất tốt các nền tảng cơ bản của một hệ thống quản lý nhà hàng (CRUD món ăn, quản lý nhân viên, phân quyền bảo mật cao, OTP email, thống kê doanh số chuyên sâu). Tuy nhiên, để trở thành hệ sinh thái **menu thông minh QDish** thực thụ, backend cần trải qua quá trình nâng cấp mạnh mẽ trong việc mở rộng cơ sở dữ liệu món ăn (Calo, dinh dưỡng, nhãn xanh), sửa đổi logic khóa bàn ăn, xây dựng hệ thống hồ sơ sức khỏe khách hàng và thuật toán gợi ý món ăn cá nhân hóa.

---
*Báo cáo được chuẩn bị bởi Antigravity AI Coding Assistant.*
