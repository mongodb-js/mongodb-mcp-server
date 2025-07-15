// Test CommonJS
try {
    const cjsModule = require("./dist/cjs/index.js");
    console.log("✅ CommonJS require works:", typeof cjsModule);
} catch (error) {
    console.log("❌ CommonJS require failed:", error.message);
}

// Test ESM
import("./dist/esm/index.js")
    .then((esmModule) => {
        console.log("✅ ESM import works:", typeof esmModule);
    })
    .catch((error) => {
        console.log("❌ ESM import failed:", error.message);
    });
