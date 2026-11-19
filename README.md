# SmartRoom

ระบบจองห้องติวหนังสือในมหาวิทยาลัย แสดงสถานะห้องจากการจองและการเช็กอินจริง

## เทคโนโลยี

- Bun + TypeScript (strict)
- Neon Postgres สำหรับเก็บข้อมูลถาวร
- Vercel Functions สำหรับ REST API
- Frontend TypeScript แบบไม่ใช้ framework
- Polling อัปเดตสถานะห้องทุก 10 วินาที

## รันในเครื่อง

1. สร้างฐานข้อมูล Postgres ใน Neon และคัดลอก connection string
2. สร้างไฟล์ `.env` โดยใส่:

   ```text
   DATABASE_URL=postgresql://...
   ```

3. รันคำสั่ง:

   ```bash
   bun install
   bun run dev
   ```

4. เปิด `http://localhost:3000`

Schema และข้อมูลตัวอย่างจะถูกสร้างโดยอัตโนมัติเมื่อมีการเรียก API ครั้งแรก

## Deploy ด้วย GitHub และ Vercel

1. Push โค้ดขึ้น GitHub โดยอย่า push ไฟล์ `.env` หรือ connection string
2. สร้างโปรเจกต์ฐานข้อมูลบน Neon แล้วคัดลอก `DATABASE_URL`
3. ใน Vercel เลือก **Add New Project** และ Import repository จาก GitHub
4. ใน Project Settings → Environment Variables เพิ่ม `DATABASE_URL` สำหรับ Production (และ Preview หากต้องการ)
5. Deploy โปรเจกต์ Vercel จะรัน `bun run build` และสร้าง API Function จากโฟลเดอร์ `api/`
6. เปิด URL ที่ Vercel ให้มา

Vercel Functions ไม่เปิด WebSocket ค้างไว้ แอปจึงดึงสถานะจาก API ทุก 10 วินาทีแทน
การจองที่เกินเวลาเช็กอินจะถูกปล่อยคืนเมื่อมีการเรียก API ครั้งถัดไป

## คำสั่ง

```bash
bun run build      # สร้าง frontend ลง public/
bun run dev        # build และเปิด server สำหรับพัฒนา
bun run start      # build และเปิด server
bun run typecheck  # ตรวจ TypeScript
```
