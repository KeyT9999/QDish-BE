import nodemailer from "nodemailer";

const {
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  SMTP_PASS,
  SMTP_SECURE,
  MAIL_FROM
} = process.env;

const port = Number(SMTP_PORT || 587);
const secure = SMTP_SECURE ? SMTP_SECURE === "true" : port === 465;

const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port,
  secure,
  auth: SMTP_USER
    ? {
        user: SMTP_USER,
        pass: SMTP_PASS
      }
    : undefined
});

export interface PasswordResetMailParams {
  to: string;
  restaurantName: string;
  ownerName?: string;
  otp: string;
}

export const sendPasswordResetEmail = async ({
  to,
  restaurantName,
  ownerName,
  otp
}: PasswordResetMailParams) => {
  if (!SMTP_HOST) {
    throw new Error("SMTP_HOST chưa được cấu hình");
  }

  const from = MAIL_FROM || SMTP_USER || "no-reply@example.com";
  const greeting = ownerName ? `Anh/chị ${ownerName}` : restaurantName;

  const text = [
    `Xin chào ${greeting},`,
    "",
    "Hệ thống nhận được yêu cầu đổi mật khẩu cho tài khoản quản trị nhà hàng.",
    "Vui lòng sử dụng mã OTP dưới đây để đặt lại mật khẩu:",
    `Mã OTP: ${otp}`,
    "",
    "Lưu ý: đường link/mã OTP chỉ có hiệu lực trong 15 phút.",
    "",
    "Nếu bạn không yêu cầu đổi mật khẩu, vui lòng bỏ qua email này."
  ].join("\n");

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5;">
      <p>Xin chào <strong>${greeting}</strong>,</p>
      <p>Hệ thống nhận được yêu cầu đổi mật khẩu cho tài khoản quản trị nhà hàng.</p>
      <p>Vui lòng sử dụng mã OTP dưới đây để đặt lại mật khẩu:</p>
      <p style="font-size: 20px; font-weight: bold; letter-spacing: 4px;">${otp}</p>
      <p><em>Mã OTP chỉ có hiệu lực trong 15 phút.</em></p>
      <p>Nếu bạn không yêu cầu đổi mật khẩu, vui lòng bỏ qua email này.</p>
    </div>
  `;

  await transporter.sendMail({
    from,
    to,
    subject: "Đặt lại mật khẩu tài khoản nhà hàng",
    text,
    html
  });
};

export interface WelcomeRestaurantMailParams {
  to: string;
  restaurantName: string;
  ownerName?: string;
  username: string;
  password: string;
  dashboardUrl: string;
}

export const sendNewRestaurantWelcomeEmail = async ({
  to,
  restaurantName,
  ownerName,
  username,
  password,
  dashboardUrl
}: WelcomeRestaurantMailParams) => {
  if (!SMTP_HOST) {
    throw new Error("SMTP_HOST chưa được cấu hình");
  }

  const from = MAIL_FROM || SMTP_USER || "no-reply@example.com";
  const greeting = ownerName ? `Anh/chị ${ownerName}` : restaurantName;

  const text = [
    `Xin chào ${greeting},`,
    "",
    "Nhà hàng của bạn đã được kích hoạt trên hệ thống QR Food Order.",
    "",
    `Thông tin đăng nhập:`,
    `- Tên đăng nhập: ${username}`,
    `- Mật khẩu tạm: ${password}`,
    "",
    `Trang quản lý: ${dashboardUrl}`,
    "",
    "Vui lòng đăng nhập và đổi mật khẩu ngay tại mục Đổi mật khẩu để đảm bảo an toàn.",
    "",
    "Chúc bạn kinh doanh hiệu quả!"
  ].join("\n");

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6;">
      <p>Xin chào <strong>${greeting}</strong>,</p>
      <p>Nhà hàng của bạn đã được kích hoạt trên hệ thống <strong>QR Food Order</strong>.</p>
      <p><strong>Thông tin đăng nhập:</strong></p>
      <ul>
        <li>Tên đăng nhập: <code>${username}</code></li>
        <li>Mật khẩu tạm: <code>${password}</code></li>
      </ul>
      <p>Trang quản lý: <a href="${dashboardUrl}">${dashboardUrl}</a></p>
      <p>Vui lòng đăng nhập và đổi mật khẩu ngay tại mục <em>Đổi mật khẩu</em> để đảm bảo an toàn.</p>
      <p>Chúc bạn kinh doanh hiệu quả!</p>
    </div>
  `;

  await transporter.sendMail({
    from,
    to,
    subject: "Chào mừng nhà hàng mới trên QR Food Order",
    text,
    html
  });
};

export interface EmailChangeMailParams {
  to: string;
  restaurantName: string;
  ownerName?: string;
  otp: string;
  newEmail: string;
}

export const sendEmailChangeOTP = async ({
  to,
  restaurantName,
  ownerName,
  otp,
  newEmail
}: EmailChangeMailParams) => {
  if (!SMTP_HOST) {
    throw new Error("SMTP_HOST chưa được cấu hình");
  }

  const from = MAIL_FROM || SMTP_USER || "no-reply@example.com";
  const greeting = ownerName ? `Anh/chị ${ownerName}` : restaurantName;

  const text = [
    `Xin chào ${greeting},`,
    "",
    "Hệ thống nhận được yêu cầu đổi email cho nhà hàng của bạn.",
    `Email mới: ${newEmail}`,
    "",
    "Vui lòng sử dụng mã OTP dưới đây để xác thực đổi email:",
    `Mã OTP: ${otp}`,
    "",
    "Lưu ý: mã OTP chỉ có hiệu lực trong 15 phút.",
    "",
    "Nếu bạn không yêu cầu đổi email, vui lòng bỏ qua email này và liên hệ với quản trị viên."
  ].join("\n");

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5;">
      <p>Xin chào <strong>${greeting}</strong>,</p>
      <p>Hệ thống nhận được yêu cầu đổi email cho nhà hàng của bạn.</p>
      <p><strong>Email mới:</strong> ${newEmail}</p>
      <p>Vui lòng sử dụng mã OTP dưới đây để xác thực đổi email:</p>
      <p style="font-size: 20px; font-weight: bold; letter-spacing: 4px;">${otp}</p>
      <p><em>Mã OTP chỉ có hiệu lực trong 15 phút.</em></p>
      <p>Nếu bạn không yêu cầu đổi email, vui lòng bỏ qua email này và liên hệ với quản trị viên.</p>
    </div>
  `;

  await transporter.sendMail({
    from,
    to,
    subject: "Xác thực đổi email nhà hàng",
    text,
    html
  });
};

export interface NewOrderNotificationParams {
  to: string;
  restaurantName: string;
  ownerName?: string;
  orderId: string;
  tableNumber: string;
  items: Array<{ name: string; price: number; quantity: number }>;
  totalAmount: number;
  note?: string;
  orderTime: Date;
}

export const sendNewOrderNotification = async ({
  to,
  restaurantName,
  ownerName,
  orderId,
  tableNumber,
  items,
  totalAmount,
  note,
  orderTime
}: NewOrderNotificationParams) => {
  if (!SMTP_HOST) {
    throw new Error("SMTP_HOST chưa được cấu hình");
  }

  const from = MAIL_FROM || SMTP_USER || "no-reply@example.com";
  const greeting = ownerName ? `Anh/chị ${ownerName}` : restaurantName;

  const itemsList = items.map(item => 
    `  - ${item.name} x${item.quantity}: ${(item.price * item.quantity).toLocaleString('vi-VN')}đ`
  ).join('\n');

  const text = [
    `Xin chào ${greeting},`,
    "",
    "Bạn có một đơn hàng mới từ khách hàng!",
    "",
    `Mã đơn hàng: ${orderId}`,
    `Số bàn: ${tableNumber}`,
    `Thời gian: ${orderTime.toLocaleString('vi-VN')}`,
    "",
    "Danh sách món:",
    itemsList,
    "",
    `Tổng tiền: ${totalAmount.toLocaleString('vi-VN')}đ`,
    note ? `Ghi chú: ${note}` : "",
    "",
    "Vui lòng kiểm tra và xử lý đơn hàng trong hệ thống quản lý."
  ].filter(Boolean).join('\n');

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6;">
      <p>Xin chào <strong>${greeting}</strong>,</p>
      <p style="font-size: 18px; color: #ea580c; font-weight: bold;">🔔 Bạn có một đơn hàng mới từ khách hàng!</p>
      
      <div style="background-color: #f9fafb; padding: 16px; border-radius: 8px; margin: 16px 0;">
        <p><strong>Mã đơn hàng:</strong> ${orderId}</p>
        <p><strong>Số bàn:</strong> <span style="font-size: 18px; color: #ea580c; font-weight: bold;">${tableNumber}</span></p>
        <p><strong>Thời gian:</strong> ${orderTime.toLocaleString('vi-VN')}</p>
      </div>

      <div style="margin: 16px 0;">
        <p><strong>Danh sách món:</strong></p>
        <table style="width: 100%; border-collapse: collapse; margin-top: 8px;">
          <thead>
            <tr style="background-color: #f3f4f6;">
              <th style="padding: 8px; text-align: left; border: 1px solid #e5e7eb;">Món</th>
              <th style="padding: 8px; text-align: center; border: 1px solid #e5e7eb;">Số lượng</th>
              <th style="padding: 8px; text-align: right; border: 1px solid #e5e7eb;">Thành tiền</th>
            </tr>
          </thead>
          <tbody>
            ${items.map(item => `
              <tr>
                <td style="padding: 8px; border: 1px solid #e5e7eb;">${item.name}</td>
                <td style="padding: 8px; text-align: center; border: 1px solid #e5e7eb;">${item.quantity}</td>
                <td style="padding: 8px; text-align: right; border: 1px solid #e5e7eb;">${(item.price * item.quantity).toLocaleString('vi-VN')}đ</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <div style="background-color: #fef3c7; padding: 12px; border-radius: 8px; margin: 16px 0;">
        <p style="margin: 0; font-size: 18px; font-weight: bold; color: #92400e;">
          Tổng tiền: ${totalAmount.toLocaleString('vi-VN')}đ
        </p>
      </div>

      ${note ? `
        <div style="background-color: #fee2e2; padding: 12px; border-radius: 8px; margin: 16px 0;">
          <p style="margin: 0;"><strong>Ghi chú từ khách:</strong></p>
          <p style="margin: 4px 0 0 0; color: #991b1b;">${note}</p>
        </div>
      ` : ''}

      <p style="margin-top: 24px; padding: 12px; background-color: #dbeafe; border-radius: 8px;">
        Vui lòng kiểm tra và xử lý đơn hàng trong hệ thống quản lý.
      </p>
    </div>
  `;

  await transporter.sendMail({
    from,
    to,
    subject: `🔔 Đơn hàng mới - Bàn ${tableNumber} - ${restaurantName}`,
    text,
    html
  });
};

export interface BankAccountChangeMailParams {
  to: string;
  restaurantName: string;
  ownerName?: string;
  otp: string;
  newBankAccount: string;
  newBankName: string;
}

export const sendBankAccountChangeOTP = async ({
  to,
  restaurantName,
  ownerName,
  otp,
  newBankAccount,
  newBankName
}: BankAccountChangeMailParams) => {
  if (!SMTP_HOST) {
    throw new Error("SMTP_HOST chưa được cấu hình");
  }

  const from = MAIL_FROM || SMTP_USER || "no-reply@example.com";
  const greeting = ownerName ? `Anh/chị ${ownerName}` : restaurantName;

  const text = [
    `Xin chào ${greeting},`,
    "",
    "Hệ thống nhận được yêu cầu đổi tài khoản ngân hàng cho nhà hàng của bạn.",
    "",
    "Thông tin tài khoản ngân hàng mới:",
    `- Tên ngân hàng: ${newBankName}`,
    `- Số tài khoản: ${newBankAccount}`,
    "",
    "Vui lòng sử dụng mã OTP dưới đây để xác thực đổi tài khoản ngân hàng:",
    `Mã OTP: ${otp}`,
    "",
    "Lưu ý: mã OTP chỉ có hiệu lực trong 15 phút.",
    "",
    "Nếu bạn không yêu cầu đổi tài khoản ngân hàng, vui lòng bỏ qua email này và liên hệ với quản trị viên."
  ].join("\n");

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5;">
      <p>Xin chào <strong>${greeting}</strong>,</p>
      <p>Hệ thống nhận được yêu cầu đổi tài khoản ngân hàng cho nhà hàng của bạn.</p>
      <div style="background-color: #f9fafb; padding: 16px; border-radius: 8px; margin: 16px 0;">
        <p><strong>Thông tin tài khoản ngân hàng mới:</strong></p>
        <ul style="margin: 8px 0; padding-left: 20px;">
          <li><strong>Tên ngân hàng:</strong> ${newBankName}</li>
          <li><strong>Số tài khoản:</strong> ${newBankAccount}</li>
        </ul>
      </div>
      <p>Vui lòng sử dụng mã OTP dưới đây để xác thực đổi tài khoản ngân hàng:</p>
      <p style="font-size: 20px; font-weight: bold; letter-spacing: 4px; color: #ea580c;">${otp}</p>
      <p><em>Mã OTP chỉ có hiệu lực trong 15 phút.</em></p>
      <p>Nếu bạn không yêu cầu đổi tài khoản ngân hàng, vui lòng bỏ qua email này và liên hệ với quản trị viên.</p>
    </div>
  `;

  await transporter.sendMail({
    from,
    to,
    subject: "Xác thực đổi tài khoản ngân hàng nhà hàng",
    text,
    html
  });
};

export interface OwnerRegisterMailParams {
  to: string;
  fullName: string;
  otp: string;
}

export const sendOwnerRegisterOTP = async ({
  to,
  fullName,
  otp
}: OwnerRegisterMailParams) => {
  if (!SMTP_HOST) {
    throw new Error("SMTP_HOST chưa được cấu hình");
  }

  const from = MAIL_FROM || SMTP_USER || "no-reply@example.com";

  const text = [
    `Xin chào Anh/chị ${fullName},`,
    "",
    "Cảm ơn Anh/chị đã quan tâm và đăng ký tài khoản Chủ nhà hàng trên hệ thống QDish.",
    "Dưới đây là mã xác thực OTP của Anh/chị:",
    `Mã OTP: ${otp}`,
    "",
    "Lưu ý: Mã OTP này chỉ có hiệu lực trong 5 phút.",
    "",
    "Nếu Anh/chị không thực hiện yêu cầu này, vui lòng bỏ qua email này."
  ].join("\n");

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px; padding: 24px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
      <h2 style="color: #10b981; margin-top: 0; font-size: 22px;">Chào mừng Anh/chị ${fullName} đến với QDish!</h2>
      <p>Cảm ơn Anh/chị đã đăng ký tài khoản Chủ nhà hàng trên hệ thống quản lý gọi món <strong>QDish</strong>.</p>
      <p>Để hoàn tất quá trình đăng ký, vui lòng sử dụng mã xác thực OTP dưới đây:</p>
      <div style="background-color: #f0fdf4; border: 1px dashed #10b981; border-radius: 8px; padding: 16px; text-align: center; margin: 20px 0;">
        <span style="font-size: 28px; font-weight: bold; letter-spacing: 6px; color: #047857;">${otp}</span>
      </div>
      <p style="color: #6b7280; font-size: 13px; font-style: italic;">Mã OTP này chỉ có hiệu lực trong <strong>5 phút</strong> và chỉ sử dụng một lần duy nhất.</p>
      <hr style="border: 0; border-top: 1px solid #f3f4f6; margin: 20px 0;" />
      <p style="color: #9ca3af; font-size: 12px; margin-bottom: 0;">Nếu Anh/chị không thực hiện yêu cầu đăng ký này, vui lòng bỏ qua email này. Tài khoản sẽ không được khởi tạo nếu không được xác minh OTP.</p>
    </div>
  `;

  await transporter.sendMail({
    from,
    to,
    subject: `[QDish] Mã xác thực OTP đăng ký Chủ nhà hàng`,
    text,
    html
  });
};


