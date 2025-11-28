# Facebook Firewall Controller (ตัวอย่าง)

โครงการตัวอย่างนี้แสดงวิธีการ **บล็อก/อนุญาตการอัปโหลด-ดาวน์โหลดของ Facebook** ด้วยสองวิธี:
- ใช้ `ipset` + `iptables` บน Linux เพื่อบล็อก IP ของโดเมนที่เกี่ยวข้องกับ Facebook
- ใช้ HTTP(S) proxy (Node.js) เพื่อกรอง URL/endpoint สำหรับการอัปโหลดหรือดาวน์โหลด (เช่น `/upload`, `graph.facebook.com`)

**คำเตือน:** ใช้งานบนระบบที่คุณมีสิทธิ์เท่านั้น และตรวจสอบผลกระทบกับผู้ใช้งานในเครือข่ายก่อนใช้จริง

## การใช้งานเบื้องต้น

### 1) สคริปต์ firewall (Linux)
```bash
sudo chmod +x firewall.sh
sudo ./firewall.sh block
sudo ./firewall.sh unblock
```

### 2) Proxy (Node.js)
```bash
cd proxy
npm install
node proxy.js
```
