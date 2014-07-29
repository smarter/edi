document.addEventListener("DOMContentLoaded", function() {
  "use strict";

  let comparisonBody = document.getElementById("comparisonBody");

  loadImage("kitten.png");
  loadImage("rays.png");
  loadImage("checkerboard.png");

  document.getElementById("localFile").addEventListener("change", function(e) {
    let files = e.target.files;
    for (let i = 0, f; f = files[i]; i++) {
      if (!f.type.match("image.*")) {
        console.warn("Ignoring local file " + f.name + " with unsupported type " + f.type);
        continue;
      }
      loadImage(window.URL.createObjectURL(f));
    }
  });

  document.getElementById("addUrlForm").addEventListener("submit", function(e) {
    let imageUrl = document.getElementById("imageUrl");
    loadImage(imageUrl.value)
    imageUrl.value = "";

    // Don't actually submit the form, that would reload the page
    e.preventDefault();
  });

  function loadImage(url) {
    let img = new Image();
    img.addEventListener("load", function() {
      addLine(img);
    });
    img.crossOrigin = "Anonymous";
    img.src = url;
  }

  function addLine(img) {
    let imgCanvas = document.createElement("canvas");
    imgCanvas.width = img.width;
    imgCanvas.height = img.height;
    imgCanvas.getContext("2d").drawImage(img, 0, 0);

    let row = document.createElement("tr");
    let imgCell = document.createElement("td");
    imgCell.appendChild(img);
    row.appendChild(imgCell);
    comparisonBody.appendChild(row);

    upsample(edi_hv, imgCanvas, addCell(row));
    upsample(edi_vh, imgCanvas, addCell(row));
    upsample(daala, imgCanvas, addCell(row));
    upsample(bilinear, imgCanvas, addCell(row));
  }

  function addCell(row) {
    let cell = document.createElement("td");
    row.appendChild(cell);
    return cell;
  }

  function addCanvas(cell, _class) {
    let canvas = document.createElement("canvas");
    canvas.className = _class;
    cell.appendChild(canvas);
    return canvas;
  }

  let OD_UMV_PADDING = 32;

  function upsample(method, srcCanvas, cell) {
    let width = srcCanvas.width;
    let height = srcCanvas.height;
    let dstHeight = (height + OD_UMV_PADDING*2)*2;
    let dstWidth = (width + OD_UMV_PADDING*2)*2;
    let srcData = srcCanvas.getContext("2d").getImageData(0, 0, width, height).data;
    let buf = new Uint8ClampedArray(new ArrayBuffer(dstWidth * dstHeight * 4));
    let dstData = new ImageData(buf, dstWidth, dstHeight);
    let src = atOffset(srcData, 0);
    let dst = atOffset(buf, (OD_UMV_PADDING*2)*dstWidth + OD_UMV_PADDING*2);
    let src_stride = width;
    let dst_stride = dstWidth;

    let dstCanvas = addCanvas(cell, "unclipped");
    dstCanvas.width = dstWidth;
    dstCanvas.height = dstHeight;

    let dstClippedCanvas = addCanvas(cell, "clipped");
    dstClippedCanvas.width = dstWidth;
    dstClippedCanvas.height = dstHeight;

    method(width, height, src, dst, src_stride, dst_stride);

    dstCanvas.getContext("2d").putImageData(dstData, 0, 0);
    dstClippedCanvas.getContext("2d").putImageData(dstData, 0, 0,
     OD_UMV_PADDING*2, OD_UMV_PADDING*2, 2*width, 2*height);
  }

  function srcLuma(s, i) {
    let r = s[4*i];
    let g = s[4*i + 1];
    let b = s[4*i + 2];
    return Math.round(0.2126*r + 0.7152*g + 0.0722*b);
  }

  function setLuma(d, i, luma) {
    d[4*i] = d[4*i + 1] = d[4*i + 2] = luma;
    d[4*i + 3] = 255;
  }

  function atOffset(buf, offset) {
    // The Proxy API is part of ECMAScript 6
    return Proxy.create({
      get: function(target, attr) {
        if (attr == "plus")
          return function(offset2) {
            return atOffset(buf, offset + offset2);
          };

        let i = parseInt(attr, 10);
        return srcLuma(buf, offset + i);
      },
      set: function(target, attr, value) {
        let i = parseInt(attr, 10);
        setLuma(buf, offset + i, value);
      }
    });
  }

  function atOffset2(buf, offset) {
    // The Proxy API is part of ECMAScript 6
    return Proxy.create({
      get: function(target, attr) {
        if (attr == "plus")
          return function(offset2) {
            return atOffset2(buf, offset + offset2);
          };

        let i = parseInt(attr, 10);
        return buf[offset + i];
      },
      set: function(target, attr, value) {
        let i = parseInt(attr, 10);
        buf[offset + i] = value;
      }
    });
  }

  function bilinear(w, h, src, dst, src_stride, dst_stride) {
    let xpad = OD_UMV_PADDING;
    let ypad = OD_UMV_PADDING;
    let s = src;
    let d = dst.plus(-dst_stride*2*ypad);
    let x, y;
    for (y = -ypad; y < h + ypad; y++) {
      for (x = 0; x < w - 1; x++) {
          d[x*2] = s[x];
          d[x*2 + 1] = (s[x] + s[x + 1] + 1) >> 1;
      }
      for (x = -xpad; x < 0; x++) {
        d[x*2] = s[0];
        d[x*2 + 1] = s[0];
      }
      for (x = w - 1; x < w + xpad; x++) {
        d[x*2] = s[w - 1];
        d[x*2 + 1] = s[w - 1];
      }
      if (y >= 0 && y < h - 1)
        s = s.plus(src_stride);
      d = d.plus(2*dst_stride);
    }
    d = dst.plus(-dst_stride*2*ypad);
    for (y = -ypad; y < h + ypad - 1; y++) {
      let d1 = d;
      let d2 = d.plus(dst_stride);
      let d3 = d.plus(2*dst_stride);
      for (x = -xpad*2; x < w*2 + xpad*2; x++)
        d2[x] = (d1[x] + d3[x] + 1) >> 1;
      d = d.plus(2*dst_stride);
    }
    let d2 = d.plus(dst_stride);
    for (x = -2*xpad; x < w*2 + xpad*2; x++)
      d2[x] = d[x];
  }

  // Based on od_state_upsample8 in src/state.c in Daala
  function daala(w, h, src, dst, src_stride, dst_stride) {
    function memset(dst, c, n) {
      for (let i = 0; i < n; i++)
        dst[i] = c;
    }
    function OD_COPY(dst, src, n) {
      for (let i = 0; i < n; i++)
        dst[i] = src[i];
    }
    let ypad = OD_UMV_PADDING;
    let xpad = OD_UMV_PADDING;
    let x, y;

    let dst = dst.plus(-dst_stride*2*ypad);

    let ref_line_buf = new Array(8);
    for (let i = 0; i < 8; i++)
      ref_line_buf[i] =
      atOffset2(new Uint8ClampedArray(new ArrayBuffer(2*(w + 2*xpad))), 2*xpad);

    for (y = -ypad; y < h + ypad + 3; y++) {
      /*Horizontal filtering:*/
      if (y < h + ypad) {
        let buf;
        buf = ref_line_buf[y & 7];
        memset(buf.plus(-(xpad << 1)), src[0], (xpad - 2) << 1);
        buf[-4] = src[0];
        buf[-3] = ((31*src[0] + src[1] + 16) >> 5);
        buf[-2] = src[0];
        buf[-1] = (36*src[0] - 5*src[1] + src[1] + 16) >> 5;
        buf[0] = src[0];
        buf[1] = (20*(src[0] + src[1])
         - 5*(src[0] + src[2]) + src[0] + src[3] + 16) >> 5;
        buf[2] = src[1];
        buf[3] = (20*(src[1] + src[2])
         - 5*(src[0] + src[3]) + src[0] + src[4] + 16) >> 5;
        for (x = 2; x < w - 3; x++) {
          buf[x << 1] = src[x];
          buf[x << 1 | 1] = (20*(src[x] + src[x + 1])
           - 5*(src[x - 1] + src[x + 2]) + src[x - 2] + src[x + 3] + 16) >> 5;
        }
        buf[x << 1] = src[x];
        buf[x << 1 | 1] = (20*(src[x] + src[x + 1])
         - 5*(src[x - 1] + src[x + 2]) + src[x - 2] + src[x + 2] + 16) >> 5;
        x++;
        buf[x << 1] = src[x];
        buf[x << 1 | 1] = (20*(src[x] + src[x + 1])
         - 5*(src[x - 1] + src[x + 1]) + src[x - 2] + src[x + 1] + 16) >> 5;
        x++;
        buf[x << 1] = src[x];
        buf[x << 1 | 1] =
         (36*src[x] - 5*src[x - 1] + src[x - 2] + 16) >> 5;
        x++;
        buf[x << 1] = src[w - 1];
        buf[x << 1 | 1] = (31*src[w - 1] + src[w - 2] + 16) >> 5;
        memset(buf.plus((++x << 1)), src[w - 1], (xpad - 1) << 1);
        if (y >= 0 && y + 1 < h)
          src = src.plus(src_stride);
      }
      /*Vertical filtering:*/
      if (y >= -ypad + 3) {
        if (y < 1 || y > h + 3) {
          OD_COPY(dst.plus(-(xpad << 1)),
           ref_line_buf[(y - 3) & 7].plus(-(xpad << 1)),
           (w + (xpad << 1)) << 1);
          dst = dst.plus(dst_stride);
          OD_COPY(dst.plus(-(xpad << 1)),
           ref_line_buf[(y - 3) & 7].plus(-(xpad << 1)),
           (w + (xpad << 1)) << 1);
          dst = dst.plus(dst_stride);
        }
        else {
          let buf = new Array(6);
          buf[0] = ref_line_buf[(y - 5) & 7];
          buf[1] = ref_line_buf[(y - 4) & 7];
          buf[2] = ref_line_buf[(y - 3) & 7];
          buf[3] = ref_line_buf[(y - 2) & 7];
          buf[4] = ref_line_buf[(y - 1) & 7];
          buf[5] = ref_line_buf[(y - 0) & 7];
          OD_COPY(dst.plus(-(xpad << 1)),
           ref_line_buf[(y - 3) & 7].plus(-(xpad << 1)),
           (w + (xpad << 1)) << 1);

          dst = dst.plus(dst_stride);
          for (x = -xpad << 1; x < (w + xpad) << 1; x++) {
            dst[x] = (20*(buf[2][x] + buf[3][x])
             - 5*(buf[1][x] + buf[4][x])
             + buf[0][x] + buf[5][x] + 16) >> 5;
          }
          dst = dst.plus(dst_stride);
        }
      }
    }
  }

  function reconstruct_v(src, xstride, ystride, a, b, c, d)
  {
    let x;

    x = src[0 - 3 * ystride] * a;
    x += src[0 - 2 * ystride] * b;
    x += src[0 - 1 * ystride] * c;
    x += src[0 - 0 * ystride] * d;
    x += src[1*xstride + 0 * ystride] * d;
    x += src[1*xstride + 1 * ystride] * c;
    x += src[1*xstride + 2 * ystride] * b;
    x += src[1*xstride + 3 * ystride] * a;
    return (x + 16) >> 5;
  }

  function reconstruct_h(d1, d2, a, b, c, d)
  {
    let x;

    x = d1[-3] * a;
    x += d1[-2] * b;
    x += d1[-1] * c;
    x += d1[-0] * d;
    x += d2[0] * d;
    x += d2[1] * c;
    x += d2[2] * b;
    x += d2[3] * a;
    return (x + 16) >> 5;
  }

  // Original code by David Schleef: <./original/gstediupsample.c>
  // See also <http://schleef.org/ds/cgak-demo-1> and
  // <http://schleef.org/ds/cgak-demo-1.png>
  function edi_hv(w, h, src, dst, src_stride, dst_stride) {
    let MARGIN = 3;
    let xpad = OD_UMV_PADDING;
    let ypad = OD_UMV_PADDING;
    let x, y;
    let s = src;
    let d = dst.plus(-dst_stride*2*ypad);

    /* Horizontal filtering */
    for (y = -ypad; y < h + ypad; y++) {
      if (y >= MARGIN && y < h - MARGIN - 1) {
        for (x = 0; x < w - 1; x++) {
          let dx, dy, dx2;
          let v;

          dx = -s[-src_stride + x]
            - s[-src_stride + x + 1]
            + s[src_stride + x]
            + s[src_stride + x + 1];
          dx *= 2;

          dy = -s[-src_stride + x]
            - 2 * s[x]
            - s[src_stride + x]
            + s[-src_stride + x + 1]
            + 2 * s[x + 1]
            + s[src_stride + x + 1];

          dx2 = -s[-src_stride + x]
            + 2 * s[x]
            - s[src_stride + x]
            - s[-src_stride + x + 1]
            + 2 * s[x + 1]
            - s[src_stride + x + 1];

          if (dy < 0) {
            dy = -dy;
            dx = -dx;
          }

          if (Math.abs(dx) <= 4 * Math.abs(dx2)) {
            v = (s[x] + s[x + 1] + 1) >> 1;
          } else if (dx < 0) {
            if (dx < -2 * dy) {
              v = reconstruct_v(s.plus(x), 1, src_stride, 0, 0, 0, 16);
            } else if (dx < -dy) {
              v = reconstruct_v(s.plus(x), 1, src_stride, 0, 0, 8, 8);
            } else if (2 * dx < -dy) {
              v = reconstruct_v(s.plus(x), 1, src_stride, 0, 4, 8, 4);
            } else if (3 * dx < -dy) {
              v = reconstruct_v(s.plus(x), 1, src_stride, 1, 7, 7, 1);
            } else {
              v = reconstruct_v(s.plus(x), 1, src_stride, 4, 8, 4, 0);
            }
          } else {
            if (dx > 2 * dy) {
              v = reconstruct_v(s.plus(x), 1, -src_stride, 0, 0, 0, 16);
            } else if (dx > dy) {
              v = reconstruct_v(s.plus(x), 1, -src_stride, 0, 0, 8, 8);
            } else if (2 * dx > dy) {
              v = reconstruct_v(s.plus(x), 1, -src_stride, 0, 4, 8, 4);
            } else if (3 * dx > dy) {
              v = reconstruct_v(s.plus(x), 1, -src_stride, 1, 7, 7, 1);
            } else {
              v = reconstruct_v(s.plus(x), 1, -src_stride, 4, 8, 4, 0);
            }
          }
          d[x * 2] = s[x];
          d[x * 2 + 1] = v;
        }
        d[x * 2] = s[x];
        d[x * 2 + 1] = s[x];
      } else {
        for (x = 0; x < w - 1; x++) {
          d[x * 2] = s[x];
          d[x * 2 + 1] = (s[x] + s[x + 1] + 1) >> 1;
        }
        d[x * 2] = s[x];
        d[x * 2 + 1] = s[x];
      }
      for (x = -xpad; x < 0; x++) {
        d[x * 2] = s[0];
        d[x * 2 + 1] = s[0];
      }
      for (x = w; x < w + xpad; x++) {
        d[x * 2] = s[w - 1];
        d[x * 2 + 1] = s[w - 1];
      }

      if (y >= 0 && y < h - 1)
        s = s.plus(src_stride);
      d = d.plus(2*dst_stride);
    }
    /* Vertical filtering */
    d = dst.plus(-dst_stride*2*ypad);
    for (y = -ypad; y < h + ypad - 1; y++) {
      let d1 = d;
      let d2 = d.plus(dst_stride);
      let d3 = d.plus(2*dst_stride);

      for (x = -2*xpad; x < w * 2 + xpad*2; x++) {
        if (x >= MARGIN && x < w * 2 - MARGIN - 1) {
          let dx, dy;
          let dx2;
          let v;

          dx = -d1[x - 1]
            - d3[x - 1]
            + d1[x + 1]
            + d3[x + 1];
          dx *= 2;

          dy = -d1[x - 1]
            - 2 * d1[x]
            - d1[x + 1]
            + d3[x - 1]
            + 2 * d3[x]
            + d3[x + 1];

          dx2 = -d1[x - 1]
            + 2 * d1[x]
            - d1[x + 1]
            - d3[x - 1]
            + 2 * d3[x]
            - d3[x + 1];

          if (dy < 0) {
            dy = -dy;
            dx = -dx;
          }

          if (Math.abs(dx) <= 4 * Math.abs(dx2)) {
            v = (d1[x] + d3[x] + 1) >> 1;
          } else if (dx < 0) {
            if (dx < -2 * dy) {
              v = reconstruct_h(d1.plus(x), d3.plus(x), 0, 0, 0, 16);
            } else if (dx < -dy) {
              v = reconstruct_h(d1.plus(x), d3.plus(x), 0, 0, 8, 8);
            } else if (2 * dx < -dy) {
              v = reconstruct_h(d1.plus(x), d3.plus(x), 0, 4, 8, 4);
            } else if (3 * dx < -dy) {
              v = reconstruct_h(d1.plus(x), d3.plus(x), 1, 7, 7, 1);
            } else {
              v = reconstruct_h(d1.plus(x), d3.plus(x), 4, 8, 4, 0);
            }
          } else {
            if (dx > 2 * dy) {
              v = reconstruct_h(d3.plus(x), d1.plus(x), 0, 0, 0, 16);
            } else if (dx > dy) {
              v = reconstruct_h(d3.plus(x), d1.plus(x), 0, 0, 8, 8);
            } else if (2 * dx > dy) {
              v = reconstruct_h(d3.plus(x), d1.plus(x), 0, 4, 8, 4);
            } else if (3 * dx > dy) {
              v = reconstruct_h(d3.plus(x), d1.plus(x), 1, 7, 7, 1);
            } else {
              v = reconstruct_h(d3.plus(x), d1.plus(x), 4, 8, 4, 0);
            }
          }
          d2[x] = v;
        } else {
          d2[x] = (d1[x] + d3[x] + 1) >> 1;
        }
      }
      d = d.plus(2*dst_stride);
    }
    {
      let d1 = d;
      let d2 = d.plus(dst_stride);

      for (x = -xpad; x < w + xpad; x++) {
        d2[2 * x] = d1[2 * x];
        d2[2 * x + 1] = d1[2 * x + 1];
      }
      d = d.plus(2*dst_stride);
    }
  }

  function edi_vh(w, h, src, dst, src_stride, dst_stride) {
    let MARGIN = 3;
    let xpad = OD_UMV_PADDING;
    let ypad = OD_UMV_PADDING;
    let x, y;
    let s = src;
    let d = dst.plus(-dst_stride*2*ypad);

    /* Vertical filtering */
    for (y = -ypad; y < h + ypad; y++) {
      let s2 = s.plus(src_stride);
      let d2 = d.plus(dst_stride);
      if (y >= 0 && y < h - 1) {
        for (x = 0; x < w - 1; x++) {
          if (x >= MARGIN && x < w - MARGIN - 1) {
            let dx, dy, dx2;
            let v;

            dx = -s[x - 1]
              - s2[x - 1]
              + s[x + 1]
              + s2[x + 1];
            dx *= 2;
            dy = -s[x - 1]
              - 2 * s[x]
              - s[x + 1]
              + s2[x - 1]
              + 2 * s2[x]
              + s2[x + 1];

            dx2 = -s[x - 1]
              + 2 * s[x]
              - s[x + 1]
              - s2[x - 1]
              + 2 * s2[x]
              - s2[x + 1];

            if (dy < 0) {
              dy = -dy;
              dx = -dx;
            }

            if (Math.abs(dx) <= 4 * Math.abs(dx2)) {
              v = (s[x] + s2[x] + 1) >> 1;
            } else if (dx < 0) {
              if (dx < -2 * dy) {
                v = reconstruct_h(s.plus(x), s2.plus(x), 0, 0, 0, 16);
              } else if (dx < -dy) {
                v = reconstruct_h(s.plus(x), s2.plus(x), 0, 0, 8, 8);
              } else if (2 * dx < -dy) {
                v = reconstruct_h(s.plus(x), s2.plus(x), 0, 4, 8, 4);
              } else if (3 * dx < -dy) {
                v = reconstruct_h(s.plus(x), s2.plus(x), 1, 7, 7, 1);
              } else {
                v = reconstruct_h(s.plus(x), s2.plus(x), 4, 8, 4, 0);
              }
            } else {
              if (dx > 2 * dy) {
                v = reconstruct_h(s2.plus(x), s.plus(x), 0, 0, 0, 16);
              } else if (dx > dy) {
                v = reconstruct_h(s2.plus(x), s.plus(x), 0, 0, 8, 8);
              } else if (2 * dx > dy) {
                v = reconstruct_h(s2.plus(x), s.plus(x), 0, 4, 8, 4);
              } else if (3 * dx > dy) {
                v = reconstruct_h(s2.plus(x), s.plus(x), 1, 7, 7, 1);
              } else {
                v = reconstruct_h(s2.plus(x), s.plus(x), 4, 8, 4, 0);
              }
            }
            d[x * 2] = s[x];
            d2[x * 2] = v;
          } else {
            d[x * 2] = s[x];
            d2[x * 2] = (s[x] + s2[x] + 1) >> 1;
          }
        }
        for (x = -xpad; x < 0; x++) {
          d[x * 2] = s[0];
          d2[x * 2] = (s[0] + s2[0] + 1) >> 1;
        }
        for (x = w - 1; x < w + xpad; x++) {
          d[x * 2] = s[w - 1];
          d2[x * 2] = (s[w - 1] + s2[w - 1] + 1) >> 1;
        }
      } else {
        for (x = 0; x < w - 1; x++) {
          d[x * 2] = s[x];
          d2[x * 2] = s[x];
        }
        for (x = -xpad; x < 0; x++) {
          d[x * 2] = s[0];
          d2[x * 2] = s[0];
        }
        for (x = w - 1; x < w + xpad; x++) {
          d[x * 2] = s[w - 1];
          d2[x * 2] = s[w - 1];
        }
      }

      if (y >= 0 && y < h - 1)
        s = s.plus(src_stride);
      d = d.plus(2*dst_stride);
    }
    /* Horizontal filtering */
    d = dst.plus(-dst_stride*2*ypad);
    for (y = -2*ypad; y < 2*h + 2*ypad; y++) {
      if (y >= MARGIN && y < 2*h - MARGIN - 1) {
        let d1 = d.plus(-dst_stride);
        let d2 = d;
        let d3 = d.plus(dst_stride);
        for (x = -xpad; x < w + xpad - 1; x++) {
          let dx, dy;
          let dx2;
          let v;

          dx = -d1[2*x]
            - d1[2*x + 2]
            + d3[2*x]
            + d3[2*x + 2];
          dx *= 2;

          dy = -d1[2*x]
            - 2 * d2[2*x]
            - d3[2*x]
            + d1[2*x + 2]
            + 2 * d2[2*x + 2]
            + d3[2*x + 2];

          dx2 = -d1[2*x]
            + 2 * d2[2*x]
            - d3[2*x]
            - d1[2*x + 2]
            + 2 * d2[2*x + 2]
            - d3[2*x + 2];

          if (dy < 0) {
            dy = -dy;
            dx = -dx;
          }

          if (Math.abs(dx) <= 4 * Math.abs(dx2)) {
            v = (d2[2*x] + d2[2*x + 2] + 1) >> 1;
          } else if (dx < 0) {
            if (dx < -2 * dy) {
              v = reconstruct_v(d2.plus(2*x), 2, dst_stride, 0, 0, 0, 16);
            } else if (dx < -dy) {
              v = reconstruct_v(d2.plus(2*x), 2, dst_stride, 0, 0, 8, 8);
            } else if (2 * dx < -dy) {
              v = reconstruct_v(d2.plus(2*x), 2, dst_stride, 0, 4, 8, 4);
            } else if (3 * dx < -dy) {
              v = reconstruct_v(d2.plus(2*x), 2, dst_stride, 1, 7, 7, 1);
            } else {
              v = reconstruct_v(d2.plus(2*x), 2, dst_stride, 4, 8, 4, 0);
            }
          } else {
            if (dx > 2 * dy) {
              v = reconstruct_v(d2.plus(2*x), 2, -dst_stride, 0, 0, 0, 16);
            } else if (dx > dy) {
              v = reconstruct_v(d2.plus(2*x), 2, -dst_stride, 0, 0, 8, 8);
            } else if (2 * dx > dy) {
              v = reconstruct_v(d2.plus(2*x), 2, -dst_stride, 0, 4, 8, 4);
            } else if (3 * dx > dy) {
              v = reconstruct_v(d2.plus(2*x), 2, -dst_stride, 1, 7, 7, 1);
            } else {
              v = reconstruct_v(d2.plus(2*x), 2, -dst_stride, 4, 8, 4, 0);
            }
          }
          d2[2*x + 1] = v;
        }
      } else {
        for (x = -xpad; x < w + xpad - 1; x++)
          d[2*x + 1] = (d[2*x] + d[2*x + 2] + 1) >> 1;
      }
      d[2*x + 1] = d[2*x];
      d = d.plus(dst_stride);
    }
  }
});
