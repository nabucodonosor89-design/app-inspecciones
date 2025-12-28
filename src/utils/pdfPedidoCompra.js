import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

// Logo T&C embebido (base64)
const LOGO_TYE = "data:image/png;base64,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";

/**
 * PDF "Solicitud de compra" (A4 horizontal) emulando tu plantilla Excel.
 *
 * FIRMA (ÚLTIMA ACTUALIZACIÓN):
 * - Misma lógica que OBRA/PEDIDO:
 *   [Etiqueta gris][Valor blanco] (borde completo) + [SEP solo verticales] + [Etiqueta gris][Valor blanco] (borde completo)
 * - Se aplica tanto a la fila SOLICITADO/AUTORIZADO como a la fila FECHAS.
 *
 * @param {Object} pedido
 * @param {Array} items
 */
export async function generarPDFPedidoCompra(pedido, items) {
  // =========================
  // 1) Setup
  // =========================
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  const M = 10;
  const usableW = pageWidth - M * 2;

  const GREY = [220, 220, 220];
  const BLACK = [0, 0, 0];

  const safeText = (v) => (v === null || v === undefined ? "" : String(v));
  const formatPYDate = (value) => {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString("es-PY");
  };

  // =========================
  // 2) Layout constants
  // =========================
  const headerTop = M;
  const logoBoxW = 58;
  const logoBoxH = 30;

  const headerRightBoxW = 55;
  const headerCenterBoxW = usableW - logoBoxW - headerRightBoxW;

  const headerRowH = 12;
  const headerRowH2 = 12;

  const infoY = headerTop + logoBoxH + 6;
  const infoRowH = 10;

  // Reservas inferiores
  const footerSafe = 10;
  const firmasBlockH = 24;
  const tableBottomMargin = footerSafe + firmasBlockH + 8;

  // =========================
  // 3) Header + OBRA/PEDIDO (cada página)
  // =========================
  const drawHeaderAndInfo = () => {
    doc.setDrawColor(...BLACK);
    doc.setLineWidth(0.4);

    // Logo T&C
    doc.rect(M, headerTop, logoBoxW, logoBoxH);
    const pad = 2;
    const imgW = logoBoxW - pad * 2;
    const imgH = logoBoxH - pad * 2;
    doc.addImage(LOGO_TYE, "PNG", M + pad, headerTop + pad, imgW, imgH);

    // FORMULARIO
    doc.rect(M + logoBoxW, headerTop, headerCenterBoxW, headerRowH);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(
      "FORMULARIO",
      M + logoBoxW + headerCenterBoxW / 2,
      headerTop + headerRowH / 2 + 1,
      { align: "center", baseline: "middle" }
    );

    // FL-COM-02
    doc.rect(M + logoBoxW + headerCenterBoxW, headerTop, headerRightBoxW, headerRowH);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(
      "FL-COM-02",
      M + logoBoxW + headerCenterBoxW + headerRightBoxW / 2,
      headerTop + headerRowH / 2 + 1,
      { align: "center", baseline: "middle" }
    );

    // SOLICITUD DE COMPRA
    doc.rect(M + logoBoxW, headerTop + headerRowH, headerCenterBoxW, headerRowH2);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(
      "SOLICITUD DE COMPRA",
      M + logoBoxW + headerCenterBoxW / 2,
      headerTop + headerRowH + headerRowH2 / 2 + 1,
      { align: "center", baseline: "middle" }
    );

    // Rev. 00
    doc.rect(M + logoBoxW + headerCenterBoxW, headerTop + headerRowH, headerRightBoxW, headerRowH2);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(
      "Rev. 00",
      M + logoBoxW + headerCenterBoxW + headerRightBoxW / 2,
      headerTop + headerRowH + headerRowH2 / 2 + 1,
      { align: "center", baseline: "middle" }
    );

    // ============================================
    // OBRA / PEDIDO
    // ============================================
    const x0 = M;
    const y = infoY;
    const h = infoRowH;

    const labelW = 70;
    const valueW = 65;
    const sepW = 18;

    const needed = (labelW + valueW) * 2 + sepW;
    let valueWAdj = valueW;
    if (needed > usableW) {
      const exceso = needed - usableW;
      valueWAdj = Math.max(40, valueW - exceso / 2);
    }

    const leftBoxW = labelW + valueWAdj;
    const rightBoxW = labelW + valueWAdj;

    const leftX = x0;
    const sepX = leftX + leftBoxW;
    const rightX = sepX + sepW;

    // Caja izq
    doc.rect(leftX, y, leftBoxW, h, "D");
    doc.setFillColor(...GREY);
    doc.rect(leftX, y, labelW, h, "FD");
    doc.line(leftX + labelW, y, leftX + labelW, y + h);

    // Separador (solo verticales)
    doc.line(sepX, y, sepX, y + h);
    doc.line(sepX + sepW, y, sepX + sepW, y + h);

    // Caja der
    doc.rect(rightX, y, rightBoxW, h, "D");
    doc.setFillColor(...GREY);
    doc.rect(rightX, y, labelW, h, "FD");
    doc.line(rightX + labelW, y, rightX + labelW, y + h);

    // Textos
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(0, 0, 0);
    doc.text("OBRA/ AREA SOLICITANTE", leftX + 5, y + 6.5);
    doc.text("PEDIDO N°:", rightX + 5, y + 6.5);

    // Valores
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text("TYE", leftX + labelW + 3, y + 6.5, { maxWidth: valueWAdj - 6 });

    doc.setFont("helvetica", "bold");
    doc.text(safeText(pedido?.numero_pedido), rightX + labelW + 3, y + 6.5, { maxWidth: valueWAdj - 6 });

    doc.setFont("helvetica", "normal");
  };

  // =========================
  // 4) Bloque firmas
  // =========================
  const drawFirmas = () => {
    const yBase = pageHeight - footerSafe - 24;

    const x0 = M;
    const totalW = usableW;

    const labelW = 55;
    const valueW = 65;
    const sepW = 18;
    const rowH = 10;

    const needed = (labelW + valueW) * 2 + sepW;
    let valueWAdj = valueW;
    if (needed > totalW) {
      const exceso = needed - totalW;
      valueWAdj = Math.max(40, valueW - exceso / 2);
    }

    const leftBoxW = labelW + valueWAdj;
    const rightBoxW = labelW + valueWAdj;

    const leftX = x0;
    const sepX = leftX + leftBoxW;
    const rightX = sepX + sepW;

    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.4);

    // =========================
    // FILA 1: SOLICITADO / AUTORIZADO
    // =========================
    const y1 = yBase;

    // Caja izq
    doc.rect(leftX, y1, leftBoxW, rowH, "D");
    doc.setFillColor(...GREY);
    doc.rect(leftX, y1, labelW, rowH, "FD");
    doc.line(leftX + labelW, y1, leftX + labelW, y1 + rowH);

    // Separador
    doc.line(sepX, y1, sepX, y1 + rowH);
    doc.line(sepX + sepW, y1, sepX + sepW, y1 + rowH);

    // Caja der
    doc.rect(rightX, y1, rightBoxW, rowH, "D");
    doc.setFillColor(...GREY);
    doc.rect(rightX, y1, labelW, rowH, "FD");
    doc.line(rightX + labelW, y1, rightX + labelW, y1 + rowH);

    // Textos fila 1
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(0, 0, 0);
    doc.text("SOLICITADO POR:", leftX + 5, y1 + 6.5);
    doc.text("AUTORIZADO POR:", rightX + 5, y1 + 6.5);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(safeText(pedido?.solicitado_por), leftX + labelW + 3, y1 + 6.5, { maxWidth: valueWAdj - 6 });

    if (pedido?.autorizado_por) {
      doc.text(safeText(pedido.autorizado_por), rightX + labelW + 3, y1 + 6.5, { maxWidth: valueWAdj - 6 });
    }
    // Si no hay autorizado_por, dejar la celda vacía (sin texto)

    // =========================
    // FILA 2: FECHAS
    // =========================
    const y2 = yBase + rowH;

    // Caja izq
    doc.rect(leftX, y2, leftBoxW, rowH, "D");
    doc.setFillColor(...GREY);
    doc.rect(leftX, y2, labelW, rowH, "FD");
    doc.line(leftX + labelW, y2, leftX + labelW, y2 + rowH);

    // Separador
    doc.line(sepX, y2, sepX, y2 + rowH);
    doc.line(sepX + sepW, y2, sepX + sepW, y2 + rowH);

    // Caja der
    doc.rect(rightX, y2, rightBoxW, rowH, "D");
    doc.setFillColor(...GREY);
    doc.rect(rightX, y2, labelW, rowH, "FD");
    doc.line(rightX + labelW, y2, rightX + labelW, y2 + rowH);

    // Textos fila 2
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(0, 0, 0);
    doc.text("FECHA:", leftX + 5, y2 + 6.5);
    doc.text("FECHA:", rightX + 5, y2 + 6.5);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(formatPYDate(pedido?.fecha_solicitud), leftX + labelW + 3, y2 + 6.5, { maxWidth: valueWAdj - 6 });

    if (pedido?.fecha_autorizacion) {
      doc.text(formatPYDate(pedido.fecha_autorizacion), rightX + labelW + 3, y2 + 6.5, { maxWidth: valueWAdj - 6 });
    }
  };

  // =========================
  // 5) Footer
  // =========================
  const drawFooter = (pageNumber, totalPages) => {
    doc.setFontSize(8);
    doc.setTextColor(128, 128, 128);
    doc.setFont("helvetica", "normal");
    doc.text(`Página ${pageNumber} de ${totalPages}`, pageWidth / 2, pageHeight - 6, { align: "center" });

    doc.setTextColor(0, 0, 0);
  };

  // =========================
  // 6) Tabla
  // =========================
  const tableStartY = infoY + infoRowH + 6;

  const tableData = (items || []).map((item) => ([
    safeText(item?.item_numero),
    safeText(item?.descripcion),
    safeText(item?.especificaciones),
    safeText(item?.unidad_medida),
    safeText(item?.cantidad),
    safeText(item?.fecha_lugar_entrega),
    safeText(item?.observacion),
  ]));

  autoTable(doc, {
    startY: tableStartY,
    head: [[
      "ITEM\nNº",
      "DESCRIPCIÓN DEL\nMATERIAL/ SERVICIO",
      "ESPECIFICACIONES\nTÉCNICAS",
      "UNIDAD DE\nMEDIDA",
      "CANTIDAD",
      "FECHA Y LUGAR DE\nENTREGA",
      "OBSERVACIÓN / V°B°\nTÉCNICO",
    ]],
    body: tableData.length ? tableData : [["", "", "", "", "", "", ""]],
    theme: "grid",
    showHead: "everyPage",
    margin: { left: M, right: M, top: M, bottom: tableBottomMargin },
    styles: {
      font: "helvetica",
      fontSize: 8,
      cellPadding: 2,
      overflow: "linebreak",
      valign: "middle",
      lineWidth: 0.3,
      lineColor: BLACK,
    },
    headStyles: {
      fillColor: GREY,
      textColor: BLACK,
      fontStyle: "bold",
      halign: "center",
      valign: "middle",
      lineWidth: 0.3,
      lineColor: BLACK,
    },
    bodyStyles: { minCellHeight: 8 },
    columnStyles: {
      0: { cellWidth: 14, halign: "center" },
      1: { cellWidth: 55 },
      2: { cellWidth: 48 },
      3: { cellWidth: 28, halign: "center" },
      4: { cellWidth: 22, halign: "center" },
      5: { cellWidth: 48 },
      6: { cellWidth: "auto" },
    },
    didDrawPage: () => drawHeaderAndInfo(),
  });

  // Firmas en la última página
  doc.setPage(doc.getNumberOfPages());
  drawFirmas();

  // Footer en todas las páginas
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    drawFooter(i, totalPages);
  }

  const nombreArchivo = `Pedido_Compra_${safeText(pedido?.numero_pedido).replaceAll("/", "-")}.pdf`;
  doc.save(nombreArchivo);
}


