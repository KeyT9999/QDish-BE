## QR Food Order Server

### Cấu trúc

- `src/index.ts`: entry, cấu hình Express + routes
- `src/config/db.ts`: logic kết nối MongoDB
- `src/models/Restaurant.ts`: schema nhà hàng
- `src/models/User.ts`: tài khoản đăng nhập (Super Admin / Restaurant Admin)
- `src/routes/restaurantRoutes.ts`: CRUD cơ bản cho nhà hàng
- `src/routes/authRoutes.ts`: đăng nhập và phát JWT
- `src/scripts/createSuperAdmin.ts`: script tạo user admin ban đầu

### Thiết lập

```bash
cd server
npm install
```

### Chạy server

```bash
npm run dev   # dùng tsx watch
# hoặc build + start
npm run build
npm start
```

### Seed Super Admin

```bash
npm run seed:super-admin -- admin admin123
```

(đổi `admin admin123` thành tài khoản/mật khẩu bạn muốn)

### API mẫu

- `POST /api/auth/login` (body: `{ "username": "", "password": "" }`)
- `GET /api/health`
- `GET /api/restaurants`
- `POST /api/restaurants` ({ name, address?, isActive? })
- `PATCH /api/restaurants/:id`
- `DELETE /api/restaurants/:id`
