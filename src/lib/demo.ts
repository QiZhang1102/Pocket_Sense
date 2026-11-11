import { demoProfile } from "./ph";
import { type Photo } from "./image";
export function demoPhoto(kind: "ph" | "color"): Photo {
  const canvas = document.createElement("canvas");
  canvas.width = 1000;
  canvas.height = 700;
  const c = canvas.getContext("2d", { willReadFrequently: true })!;
  if (kind === "ph") {
    c.fillStyle = "#E9E6D8";
    c.fillRect(0, 0, 1000, 700);
    c.fillStyle = "#F9F7EF";
    c.fillRect(55, 60, 890, 200);
    c.fillStyle = "#4B514B";
    c.font = "20px sans-serif";
    c.fillText("SYNTHETIC REFERENCE / pH 4—10", 80, 95);
    demoProfile.patches.forEach((p, i) => {
      c.fillStyle = p.hex;
      c.fillRect(80 + i * 120, 120, 100, 85);
      c.fillStyle = "#4B514B";
      c.fillText(String(p.ph), 120 + i * 120, 235);
    });
    c.shadowColor = "#4b514b35";
    c.shadowBlur = 25;
    c.shadowOffsetY = 10;
    c.fillStyle = "#FDFBF3";
    c.fillRect(330, 320, 340, 230);
    c.shadowColor = "transparent";
    c.fillStyle = "#94B889";
    c.fillRect(420, 345, 160, 155);
    c.fillStyle = "#CCC5B6";
    c.fillRect(780, 425, 115, 115);
    c.fillStyle = "#4B514B";
    c.font = "16px sans-serif";
    c.fillText("NEUTRAL REFERENCE", 740, 570);
    c.fillText("ILLUSTRATIVE SAMPLE · NOT EXPERIMENTAL DATA", 80, 640);
  } else {
    const sky = c.createLinearGradient(0, 0, 0, 700);
    sky.addColorStop(0, "#777EAF");
    sky.addColorStop(0.45, "#D69AAA");
    sky.addColorStop(0.7, "#F2BD91");
    sky.addColorStop(1, "#E4C9A4");
    c.fillStyle = sky;
    c.fillRect(0, 0, 1000, 700);
    c.fillStyle = "#F8D6A1";
    c.beginPath();
    c.arc(670, 270, 75, 0, 2 * Math.PI);
    c.fill();
    c.fillStyle = "#8F8C9F";
    c.beginPath();
    c.moveTo(0, 470);
    c.bezierCurveTo(200, 310, 270, 570, 560, 450);
    c.bezierCurveTo(760, 360, 850, 500, 1000, 425);
    c.lineTo(1000, 700);
    c.lineTo(0, 700);
    c.fill();
    c.fillStyle = "#626C7E";
    c.beginPath();
    c.moveTo(0, 580);
    c.bezierCurveTo(200, 460, 300, 640, 550, 530);
    c.bezierCurveTo(800, 420, 850, 560, 1000, 510);
    c.lineTo(1000, 700);
    c.lineTo(0, 700);
    c.fill();
    c.fillStyle = "#3D535F";
    c.beginPath();
    c.moveTo(0, 650);
    c.bezierCurveTo(330, 540, 580, 710, 1000, 595);
    c.lineTo(1000, 700);
    c.lineTo(0, 700);
    c.fill();
  }
  return {
    pixels: c.getImageData(0, 0, 1000, 700),
    originalWidth: 1000,
    originalHeight: 700,
    name:
      kind === "ph"
        ? "Synthetic pH strip demo"
        : "Synthetic sunset · Algorithm demo",
    demo: true,
  };
}
