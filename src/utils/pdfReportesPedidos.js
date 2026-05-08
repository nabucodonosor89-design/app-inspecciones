import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import JSZip from "jszip";
import { saveAs } from "file-saver";

// Logo T&C (mismo que usan en pedidos de compra)
const LOGO_TYE =
  "data:image/png;base64,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";

function safeText(v) {
  return v === null || v === undefined ? "" : String(v);
}

function safeFilePart(s) {
  return safeText(s)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_\-]/g, "_")
    .replace(/_+/g, "_");
}

function fechaHoyISO() {
  return new Date().toISOString().split("T")[0];
}

/**
 * Genera PDFs individuales por solicitante y los descarga en un ZIP
 * @param {Array} pedidos
 * @param {Array} obras (opcional) para fallback si pedido.obra no viene expandido
 */
export async function generarReportesSemanalesPDF(pedidos, obras = []) {
  try {
    if (!Array.isArray(pedidos) || pedidos.length === 0) {
      throw new Error("No hay pedidos para generar reportes.");
    }

    // Mapa de obras por id/código (fallback)
    const obrasById = new Map();
    const obrasByCodigo = new Map();
    for (const o of Array.isArray(obras) ? obras : []) {
      if (o?.id) obrasById.set(o.id, o);
      if (o?.codigo_obra) obrasByCodigo.set(o.codigo_obra, o);
    }

    // Agrupar pedidos por solicitante
    const pedidosPorSolicitante = {};
    pedidos.forEach((pedido) => {
      const email = safeText(pedido?.email_solicitante) || "sin_email";
      if (!pedidosPorSolicitante[email]) pedidosPorSolicitante[email] = [];
      pedidosPorSolicitante[email].push(pedido);
    });

    // Crear ZIP
    const zip = new JSZip();

    // Generar PDF para cada solicitante
    for (const [email, pedidosSolicitante] of Object.entries(
      pedidosPorSolicitante
    )) {
      const pdfBlob = await generarPDFSolicitante(
        email,
        pedidosSolicitante,
        obrasById,
        obrasByCodigo
      );

      const nombreArchivo = `reporte_${safeFilePart(email)}.pdf`;
      zip.file(nombreArchivo, pdfBlob);
    }

    // Descargar ZIP
    const zipBlob = await zip.generateAsync({ type: "blob" });
    saveAs(zipBlob, `reportes_pedidos_${fechaHoyISO()}.zip`);

    return true;
  } catch (error) {
    console.error("Error generando reportes:", error);
    throw error;
  }
}

/**
 * Aplica footer correcto (página X de N) una vez que el documento ya tiene todas las páginas.
 */
function aplicarFooter(doc) {
  const pageCount = doc.internal.getNumberOfPages();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);

    doc.setFontSize(8);
    doc.setTextColor(107, 114, 128);

    doc.text(`Página ${i} de ${pageCount}`, pageWidth / 2, pageHeight - 8, {
      align: "center",
    });

    doc.setFontSize(7);
    doc.text(
      "Generado por Sistema TyE - " + new Date().toLocaleString("es-PY"),
      pageWidth / 2,
      pageHeight - 4,
      { align: "center" }
    );
  }
}

/**
 * Genera PDF individual para un solicitante usando formato corporativo T&C
 */
async function generarPDFSolicitante(
  emailSolicitante,
  pedidos,
  obrasById,
  obrasByCodigo
) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  const M = 10; // Margen
  const usableW = pageWidth - M * 2;

  const GREY = [220, 220, 220];
  const BLACK = [0, 0, 0];

  // ============================================
  // ENCABEZADO CORPORATIVO
  // ============================================

  const headerTop = M;
  const logoBoxW = 50;
  const logoBoxH = 25;

  const headerRightBoxW = 45;
  const headerCenterBoxW = usableW - logoBoxW - headerRightBoxW;

  const headerRowH = 10;

  // Logo T&C
  doc.setDrawColor(...BLACK);
  doc.setLineWidth(0.4);
  doc.rect(M, headerTop, logoBoxW, logoBoxH, "S");

  const pad = 2;
  const imgW = logoBoxW - pad * 2;
  const imgH = logoBoxH - pad * 2;
  doc.addImage(LOGO_TYE, "PNG", M + pad, headerTop + pad, imgW, imgH);

  // REPORTE
  doc.rect(M + logoBoxW, headerTop, headerCenterBoxW, headerRowH, "S");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(
    "REPORTE",
    M + logoBoxW + headerCenterBoxW / 2,
    headerTop + headerRowH / 2 + 1,
    { align: "center", baseline: "middle" }
  );

  // Código
  doc.rect(
    M + logoBoxW + headerCenterBoxW,
    headerTop,
    headerRightBoxW,
    headerRowH,
    "S"
  );
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(
    "RPT-TYE-01",
    M + logoBoxW + headerCenterBoxW + headerRightBoxW / 2,
    headerTop + headerRowH / 2 + 1,
    { align: "center", baseline: "middle" }
  );

  // ESTADO DE PEDIDOS
  doc.rect(
    M + logoBoxW,
    headerTop + headerRowH,
    headerCenterBoxW,
    headerRowH,
    "S"
  );
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text(
    "ESTADO DE PEDIDOS DE EQUIPOS",
    M + logoBoxW + headerCenterBoxW / 2,
    headerTop + headerRowH + headerRowH / 2 + 1,
    { align: "center", baseline: "middle" }
  );

  // Rev. 00
  doc.rect(
    M + logoBoxW + headerCenterBoxW,
    headerTop + headerRowH,
    headerRightBoxW,
    headerRowH,
    "S"
  );
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(
    "Rev. 00",
    M + logoBoxW + headerCenterBoxW + headerRightBoxW / 2,
    headerTop + headerRowH + headerRowH / 2 + 1,
    { align: "center", baseline: "middle" }
  );

  // ============================================
  // INFORMACIÓN DEL SOLICITANTE
  // ============================================

  const infoY = headerTop + logoBoxH + 8;
  const infoRowH = 10;

  const labelW = 55;

  // Fila 1: Solicitante
  doc.rect(M, infoY, usableW, infoRowH, "S");
  doc.setFillColor(...GREY);
  doc.rect(M, infoY, labelW, infoRowH, "FD");
  doc.line(M + labelW, infoY, M + labelW, infoY + infoRowH);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);
  doc.text("SOLICITANTE:", M + 3, infoY + 6.5);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(safeText(emailSolicitante), M + labelW + 3, infoY + 6.5);

  // Fila 2: Fecha
  const infoY2 = infoY + infoRowH;
  doc.rect(M, infoY2, usableW, infoRowH, "S");
  doc.setFillColor(...GREY);
  doc.rect(M, infoY2, labelW, infoRowH, "FD");
  doc.line(M + labelW, infoY2, M + labelW, infoY2 + infoRowH);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("FECHA:", M + 3, infoY2 + 6.5);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const fechaHoy = new Date().toLocaleDateString("es-PY", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  doc.text(fechaHoy, M + labelW + 3, infoY2 + 6.5);

  // Fila 3: Total Equipos Pendientes
  const infoY3 = infoY2 + infoRowH;
  doc.rect(M, infoY3, usableW, infoRowH, "S");
  doc.setFillColor(...GREY);
  doc.rect(M, infoY3, labelW, infoRowH, "FD");
  doc.line(M + labelW, infoY3, M + labelW, infoY3 + infoRowH);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("EQUIPOS PENDIENTES:", M + 3, infoY3 + 6.5);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(239, 68, 68); // Rojo
  doc.text(String(pedidos?.length ?? 0), M + labelW + 3, infoY3 + 6.5);
  doc.setTextColor(0, 0, 0);

  // ============================================
  // TABLA DE PEDIDOS (con Comentarios como columna)
  // ============================================

  const tableStartY = infoY3 + infoRowH + 8;

  const filas = [];

  for (const pedido of pedidos || []) {
    const obraObj =
      pedido?.obra ??
      (pedido?.obra_id ? obrasById?.get(pedido.obra_id) : null) ??
      (pedido?.codigo_obra ? obrasByCodigo?.get(pedido.codigo_obra) : null);

    const codigoObra = obraObj?.codigo_obra || "N/A";

    const estadoOT = pedido?.mantenimiento?.estado;
    const comentarios = pedido?.comentarios;

    const comentariosFinal = safeText(
      [estadoOT ? `Estado OT: ${estadoOT}` : null, comentarios]
        .filter(Boolean)
        .join(" | ")
    );

    filas.push([
      codigoObra,
      safeText(pedido?.numero_pedido || ""),
      safeText(pedido?.tipo_equipo_solicitado || ""),
      safeText(pedido?.equipo_asignado?.numero_identificacion || "Sin asignar"),
      safeText(pedido?.mantenimiento?.numero_aviso || "-"),
      comentariosFinal,
    ]);
  }

  autoTable(doc, {
    startY: tableStartY,
    head: [[
      "Obra",
      "Pedido",
      "Equipo Solicitado",
      "Equipo Asignado",
      "OT",
      "Comentarios"
    ]],
    body: filas,
    theme: "grid",
    headStyles: {
      fillColor: [102, 126, 234],
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 9,
      halign: "center",
    },
    bodyStyles: {
      fontSize: 8,
      valign: "top",
    },
    alternateRowStyles: {
      fillColor: [249, 250, 251],
    },
    columnStyles: {
      0: { cellWidth: 20 }, // Obra
      1: { cellWidth: 20 }, // Pedido
      2: { cellWidth: 38 }, // Equipo Solicitado
      3: { cellWidth: 32 }, // Equipo Asignado
      4: { cellWidth: 15 }, // OT
      5: { cellWidth: 40 }, // Comentarios
    },
    margin: { top: 10, left: M, right: M },
  });

  // ============================================
  // NOTA FINAL
  // ============================================

  const finalY = doc.lastAutoTable?.finalY || tableStartY + 20;

  if (finalY < pageHeight - 40) {
    doc.setFontSize(8);
    doc.setTextColor(107, 114, 128);
    doc.setFont("helvetica", "italic");
    doc.text(
      "Este reporte incluye únicamente los equipos que NO han sido entregados.",
      M,
      finalY + 10
    );
    doc.text(
      "Para más información, contacte al Departamento de Transporte y Equipos.",
      M,
      finalY + 15
    );
  }

  // Footer correcto (página X de N)
  aplicarFooter(doc);

  return doc.output("blob");
}

/**
 * Genera un único PDF consolidado con todos los solicitantes (alternativa)
 */
export async function generarReporteConsolidadoPDF(pedidos) {
  if (!Array.isArray(pedidos) || pedidos.length === 0) {
    throw new Error("No hay pedidos para generar el reporte consolidado.");
  }

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  // Agrupar por solicitante
  const pedidosPorSolicitante = {};
  for (const pedido of pedidos) {
    const email = safeText(pedido?.email_solicitante) || "sin_email";
    if (!pedidosPorSolicitante[email]) pedidosPorSolicitante[email] = [];
    pedidosPorSolicitante[email].push(pedido);
  }

  // Header
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text("REPORTE CONSOLIDADO - PEDIDOS PENDIENTES", 105, 20, {
    align: "center",
  });

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(`Fecha: ${new Date().toLocaleDateString("es-PY")}`, 105, 28, {
    align: "center",
  });

  let yPos = 40;

  for (const [email, pedidosSolicitante] of Object.entries(
    pedidosPorSolicitante
  )) {
    // Nueva página si hace falta
    if (yPos > 240) {
      doc.addPage();
      yPos = 20;
    }

    // Título solicitante
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text(`${email} (${pedidosSolicitante.length} equipos)`, 20, yPos);

    yPos += 5;

    const filas = pedidosSolicitante.map((p) => [
      safeText(p?.numero_pedido || ""),
      safeText(p?.tipo_equipo_solicitado || ""),
      safeText(p?.equipo_asignado?.numero_identificacion || "Sin asignar"),
      safeText(p?.mantenimiento?.numero_aviso || "-"),
      safeText(
        [
          p?.mantenimiento?.estado ? `Estado OT: ${p.mantenimiento.estado}` : null,
          p?.comentarios
        ].filter(Boolean).join(" | ")
      ),
    ]);

    autoTable(doc, {
      startY: yPos,
      head: [["Pedido", "Equipo Solicitado", "Asignado", "OT", "Comentarios"]],
      body: filas,
      theme: "plain",
      styles: { fontSize: 9, valign: "top" },
      margin: { left: 20 },
      columnStyles: {
        0: { cellWidth: 25 },
        1: { cellWidth: 55 },
        2: { cellWidth: 35 },
        3: { cellWidth: 15 },
        4: { cellWidth: 55 },
      },
    });

    yPos = (doc.lastAutoTable?.finalY || yPos + 10) + 10;
  }

  // Footer correcto (página X de N)
  aplicarFooter(doc);

  doc.save(`reporte_consolidado_${fechaHoyISO()}.pdf`);
}
