/* GStreamer
 * Copyright (C) 2013 Rdio Inc. <ingestions@rd.io>
 * Copyright (C) 2013 David Schleef <ds@schleef.org>
 *
 * This library is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Library General Public
 * License as published by the Free Software Foundation; either
 * version 2 of the License, or (at your option) any later version.
 *
 * This library is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Library General Public License for more details.
 *
 * You should have received a copy of the GNU Library General Public
 * License along with this library; if not, write to the
 * Free Software Foundation, Inc., 51 Franklin Street, Suite 500,
 * Boston, MA 02110-1335, USA.
 */
/**
 * SECTION:element-gstedi
 *
 * The edi element is a test element for deinterlacing.
 *
 * <refsect2>
 * <title>Example launch line</title>
 * |[
 * gst-launch -v videotestsrc ! edi ! xvimageisnk
 * ]|
 * </refsect2>
 */

#ifdef HAVE_CONFIG_H
#include "config.h"
#endif

#include <gst/gst.h>
#include <gst/video/video.h>
#include <gst/video/gstvideofilter.h>
#include <math.h>
#include "gstediupsample.h"

GST_DEBUG_CATEGORY_STATIC (gst_edi_upsample_debug_category);
#define GST_CAT_DEFAULT gst_edi_upsample_debug_category

/* prototypes */


static void gst_edi_upsample_set_property (GObject * object,
    guint property_id, const GValue * value, GParamSpec * pspec);
static void gst_edi_upsample_get_property (GObject * object,
    guint property_id, GValue * value, GParamSpec * pspec);
static void gst_edi_upsample_dispose (GObject * object);
static void gst_edi_upsample_finalize (GObject * object);

static gboolean gst_edi_upsample_start (GstBaseTransform * trans);
static gboolean gst_edi_upsample_stop (GstBaseTransform * trans);
static GstCaps *gst_edi_upsample_transform_caps (GstBaseTransform * trans,
    GstPadDirection direction, GstCaps * caps, GstCaps * filter);
static gboolean gst_edi_upsample_set_info (GstVideoFilter * filter,
    GstCaps * incaps, GstVideoInfo * in_info, GstCaps * outcaps,
    GstVideoInfo * out_info);
static GstFlowReturn gst_edi_upsample_transform_frame (GstVideoFilter * filter,
    GstVideoFrame * inframe, GstVideoFrame * outframe);
static GstFlowReturn gst_edi_upsample_transform_frame_cgak (GstVideoFilter *
    filter, GstVideoFrame * inframe, GstVideoFrame * outframe);
static GstFlowReturn gst_edi_upsample_transform_frame_dirac (GstVideoFilter *
    filter, GstVideoFrame * inframe, GstVideoFrame * outframe);
static GstFlowReturn gst_edi_upsample_transform_frame_bilinear (GstVideoFilter *
    filter, GstVideoFrame * inframe, GstVideoFrame * outframe);

enum
{
  PROP_0,
  PROP_METHOD
};
#define DEFAULT_METHOD GST_EDI_UPSAMPLE_METHOD_CGAK

/* pad templates */

#define VIDEO_CAPS \
    GST_VIDEO_CAPS_MAKE("{ I420, Y444, Y42B }")

/* class initialization */

#define GST_TYPE_EDI_METHOD (gst_edi_upsample_method_get_type())
static GType
gst_edi_upsample_method_get_type (void)
{
  static GType edi_method_type = 0;

  static const GEnumValue edi_methods[] = {
    {GST_EDI_UPSAMPLE_METHOD_CGAK, "Categorized Gradient Adaptive Kernel",
        "cgak"},
    {GST_EDI_UPSAMPLE_METHOD_BILINEAR, "Bilinear", "bilinear"},
    {GST_EDI_UPSAMPLE_METHOD_DIRAC, "Dirac (separable 8-tap)", "dirac"},
    {0, NULL, NULL},
  };

  if (!edi_method_type) {
    edi_method_type =
        g_enum_register_static ("GstEdiUpsampleMethod", edi_methods);
  }
  return edi_method_type;
}

G_DEFINE_TYPE_WITH_CODE (GstEdiUpsample, gst_edi_upsample,
    GST_TYPE_VIDEO_FILTER,
    GST_DEBUG_CATEGORY_INIT (gst_edi_upsample_debug_category, "ediupsample", 0,
        "debug category for ediupsample element"));

static void
gst_edi_upsample_class_init (GstEdiUpsampleClass * klass)
{
  GObjectClass *gobject_class = G_OBJECT_CLASS (klass);
  GstBaseTransformClass *base_transform_class =
      GST_BASE_TRANSFORM_CLASS (klass);
  GstVideoFilterClass *video_filter_class = GST_VIDEO_FILTER_CLASS (klass);

  gst_element_class_add_pad_template (GST_ELEMENT_CLASS (klass),
      gst_pad_template_new ("src", GST_PAD_SRC, GST_PAD_ALWAYS,
          gst_caps_from_string (VIDEO_CAPS)));
  gst_element_class_add_pad_template (GST_ELEMENT_CLASS (klass),
      gst_pad_template_new ("sink", GST_PAD_SINK, GST_PAD_ALWAYS,
          gst_caps_from_string (VIDEO_CAPS)));

  gst_element_class_set_static_metadata (GST_ELEMENT_CLASS (klass),
      "Video upsampling", "Video/Filter", "Upsample video by a factor of 2",
      "David Schleef <ds@schleef.org>");

  gobject_class->set_property = gst_edi_upsample_set_property;
  gobject_class->get_property = gst_edi_upsample_get_property;
  gobject_class->dispose = gst_edi_upsample_dispose;
  gobject_class->finalize = gst_edi_upsample_finalize;
  base_transform_class->start = GST_DEBUG_FUNCPTR (gst_edi_upsample_start);
  base_transform_class->stop = GST_DEBUG_FUNCPTR (gst_edi_upsample_stop);
  base_transform_class->transform_caps =
      GST_DEBUG_FUNCPTR (gst_edi_upsample_transform_caps);
  video_filter_class->set_info = GST_DEBUG_FUNCPTR (gst_edi_upsample_set_info);
  video_filter_class->transform_frame =
      GST_DEBUG_FUNCPTR (gst_edi_upsample_transform_frame);

  g_object_class_install_property (gobject_class, PROP_METHOD,
      g_param_spec_enum ("method", "method", "method",
          GST_TYPE_EDI_METHOD, DEFAULT_METHOD,
          G_PARAM_READWRITE | G_PARAM_STATIC_STRINGS));
}

static void
gst_edi_upsample_init (GstEdiUpsample * edi)
{
}

void
gst_edi_upsample_set_property (GObject * object, guint property_id,
    const GValue * value, GParamSpec * pspec)
{
  GstEdiUpsample *edi = GST_EDI_UPSAMPLE (object);

  GST_DEBUG_OBJECT (edi, "set_property");

  switch (property_id) {
    case PROP_METHOD:
      edi->method = g_value_get_enum (value);
      break;
    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, property_id, pspec);
      break;
  }
}

void
gst_edi_upsample_get_property (GObject * object, guint property_id,
    GValue * value, GParamSpec * pspec)
{
  GstEdiUpsample *edi = GST_EDI_UPSAMPLE (object);

  GST_DEBUG_OBJECT (edi, "get_property");

  switch (property_id) {
    case PROP_METHOD:
      g_value_set_enum (value, edi->method);
      break;
    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, property_id, pspec);
      break;
  }
}

void
gst_edi_upsample_dispose (GObject * object)
{
  GstEdiUpsample *edi = GST_EDI_UPSAMPLE (object);

  GST_DEBUG_OBJECT (edi, "dispose");

  /* clean up as possible.  may be called multiple times */

  G_OBJECT_CLASS (gst_edi_upsample_parent_class)->dispose (object);
}

void
gst_edi_upsample_finalize (GObject * object)
{
  GstEdiUpsample *edi = GST_EDI_UPSAMPLE (object);

  GST_DEBUG_OBJECT (edi, "finalize");

  /* clean up object here */

  G_OBJECT_CLASS (gst_edi_upsample_parent_class)->finalize (object);
}

static gboolean
gst_edi_upsample_start (GstBaseTransform * trans)
{
  GstEdiUpsample *edi = GST_EDI_UPSAMPLE (trans);

  GST_DEBUG_OBJECT (edi, "start");

  return TRUE;
}

static gboolean
gst_edi_upsample_stop (GstBaseTransform * trans)
{
  GstEdiUpsample *edi = GST_EDI_UPSAMPLE (trans);

  GST_DEBUG_OBJECT (edi, "stop");

  return TRUE;
}

static void
transform_value (GValue * value, gboolean dir)
{
  if (G_VALUE_HOLDS_INT (value)) {
    int val = g_value_get_int (value);
    val = dir ? (val << 1) : (val >> 1);
    g_value_set_int (value, val);
  } else if (GST_VALUE_HOLDS_INT_RANGE (value)) {
    int min = gst_value_get_int_range_min (value);
    int max = gst_value_get_int_range_max (value);
    int step = gst_value_get_int_range_step (value);

    min = dir ? (min << 1) : (min >> 1);
    max = dir ? (max << 1) : (max >> 1);
    step = dir ? (step << 1) : (step >> 1);
    if (step == 0)
      step = 1;

    gst_value_set_int_range_step (value, min, max, step);
  } else {
    GST_ERROR ("unhandled value type %s", g_type_name (G_VALUE_TYPE (value)));
  }
}

static GstCaps *
gst_edi_upsample_transform_caps (GstBaseTransform * trans,
    GstPadDirection direction, GstCaps * caps, GstCaps * filter)
{
  GstEdiUpsample *edi = GST_EDI_UPSAMPLE (trans);
  GstCaps *othercaps;

  GST_DEBUG_OBJECT (edi, "transform_caps");

  othercaps = gst_caps_copy (caps);

  /* Copy other caps and modify as appropriate */
  /* This works for the simplest cases, where the transform modifies one
   * or more fields in the caps structure.  It does not work correctly
   * if passthrough caps are preferred. */
  if (direction == GST_PAD_SRC) {
    GValue *value;
    int i;

    for (i = 0; i < gst_caps_get_size (othercaps); i++) {
      GstStructure *structure = gst_caps_get_structure (othercaps, i);
      value = (GValue *) gst_structure_get_value (structure, "width");
      if (value)
        transform_value (value, FALSE);
      value = (GValue *) gst_structure_get_value (structure, "height");
      if (value)
        transform_value (value, FALSE);
    }

    /* transform caps going upstream */
  } else {
    GValue *value;
    int i;

    for (i = 0; i < gst_caps_get_size (othercaps); i++) {
      GstStructure *structure = gst_caps_get_structure (othercaps, i);
      value = (GValue *) gst_structure_get_value (structure, "width");
      if (value)
        transform_value (value, TRUE);
      value = (GValue *) gst_structure_get_value (structure, "height");
      if (value)
        transform_value (value, TRUE);
    }

    /* transform caps going downstream */
  }

  if (filter) {
    GstCaps *intersect;

    intersect = gst_caps_intersect (othercaps, filter);
    gst_caps_unref (othercaps);

    return intersect;
  } else {
    return othercaps;
  }
}

static gboolean
gst_edi_upsample_set_info (GstVideoFilter * filter, GstCaps * incaps,
    GstVideoInfo * in_info, GstCaps * outcaps, GstVideoInfo * out_info)
{
  GstEdiUpsample *edi = GST_EDI_UPSAMPLE (filter);

  GST_DEBUG_OBJECT (edi, "set_info");

  return TRUE;
}

static int
reconstruct_v (guint8 * src, int stride, int a, int b, int c, int d)
{
  int x;

  x = src[0 - 3 * stride] * a;
  x += src[0 - 2 * stride] * b;
  x += src[0 - 1 * stride] * c;
  x += src[0 - 0 * stride] * d;
  x += src[1 + 0 * stride] * d;
  x += src[1 + 1 * stride] * c;
  x += src[1 + 2 * stride] * b;
  x += src[1 + 3 * stride] * a;
  return (x + 16) >> 5;
}

static int
reconstruct_h (guint8 * d1, guint8 * d2, int a, int b, int c, int d)
{
  int x;

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

static GstFlowReturn
gst_edi_upsample_transform_frame_cgak (GstVideoFilter * filter,
    GstVideoFrame * inframe, GstVideoFrame * outframe)
{
  GstEdiUpsample *edi = GST_EDI_UPSAMPLE (filter);
  int k;
  int i, j;
  guint8 *src_data;
  int src_stride;
  int src_width;
  int src_height;
  guint8 *dest_data;
  int dest_stride;

  GST_DEBUG_OBJECT (edi, "transform_frame");

  for (k = 0; k < 1; k++) {
    src_data = inframe->data[k];
    src_stride = GST_VIDEO_FRAME_COMP_STRIDE (inframe, k);
    src_width = GST_VIDEO_FRAME_COMP_WIDTH (inframe, k);
    src_height = GST_VIDEO_FRAME_COMP_HEIGHT (inframe, k);

    dest_data = outframe->data[k];
    dest_stride = GST_VIDEO_FRAME_COMP_STRIDE (outframe, k);

#define MARGIN 3
    for (j = 0; j < src_height; j++) {
      guint8 *s = src_data + src_stride * j;
      guint8 *d = dest_data + dest_stride * 2 * j;

      if (j >= MARGIN && j < src_height - MARGIN - 1) {
        for (i = 0; i < src_width - 1; i++) {
          int dx, dy, dx2;
          int v;

          dx = -s[-src_stride + i]
              - s[-src_stride + i + 1]
              + s[src_stride + i]
              + s[src_stride + i + 1];
          dx *= 2;

          dy = -s[-src_stride + i]
              - 2 * s[i]
              - s[src_stride + i]
              + s[-src_stride + i + 1]
              + 2 * s[i + 1]
              + s[src_stride + i + 1];

          dx2 = -s[-src_stride + i]
              + 2 * s[i]
              - s[src_stride + i]
              - s[-src_stride + i + 1]
              + 2 * s[i + 1]
              - s[src_stride + i + 1];

          if (dy < 0) {
            dy = -dy;
            dx = -dx;
          }

          if (ABS (dx) <= 4 * ABS (dx2)) {
            v = (s[i] + s[i + 1] + 1) >> 1;
          } else if (dx < 0) {
            if (dx < -2 * dy) {
              v = reconstruct_v (s + i, src_stride, 0, 0, 0, 16);
            } else if (dx < -dy) {
              v = reconstruct_v (s + i, src_stride, 0, 0, 8, 8);
            } else if (2 * dx < -dy) {
              v = reconstruct_v (s + i, src_stride, 0, 4, 8, 4);
            } else if (3 * dx < -dy) {
              v = reconstruct_v (s + i, src_stride, 1, 7, 7, 1);
            } else {
              v = reconstruct_v (s + i, src_stride, 4, 8, 4, 0);
            }
          } else {
            if (dx > 2 * dy) {
              v = reconstruct_v (s + i, -src_stride, 0, 0, 0, 16);
            } else if (dx > dy) {
              v = reconstruct_v (s + i, -src_stride, 0, 0, 8, 8);
            } else if (2 * dx > dy) {
              v = reconstruct_v (s + i, -src_stride, 0, 4, 8, 4);
            } else if (3 * dx > dy) {
              v = reconstruct_v (s + i, -src_stride, 1, 7, 7, 1);
            } else {
              v = reconstruct_v (s + i, -src_stride, 4, 8, 4, 0);
            }
          }
          d[i * 2] = s[i];
          d[i * 2 + 1] = CLAMP (v, 0, 255);
        }
        d[i * 2] = s[i];
        d[i * 2 + 1] = s[i];
      } else {
        guint8 *s = src_data + src_stride * j;
        guint8 *d1 = dest_data + dest_stride * 2 * j;
        guint8 *d2 = dest_data + dest_stride * (2 * j + 1);

        for (i = 0; i < src_width - 1; i++) {
          d1[i * 2] = s[i];
          d1[i * 2 + 1] = (s[i] + s[i + 1] + 1) >> 1;
          d2[i * 2] = s[i];
          d2[i * 2 + 1] = (s[i] + s[i + 1] + 1) >> 1;
        }
        d1[i * 2] = s[i];
        d1[i * 2 + 1] = s[i];
        d2[i * 2] = s[i];
        d2[i * 2 + 1] = s[i];
      }
    }
    for (j = 0; j < src_height - 1; j++) {
      guint8 *d1 = dest_data + dest_stride * 2 * j;
      guint8 *d2 = dest_data + dest_stride * (2 * j + 1);
      guint8 *d3 = dest_data + dest_stride * (2 * j + 2);

      for (i = 0; i < src_width * 2; i++) {
        if (i >= MARGIN && i < src_width * 2 - MARGIN - 1) {
          int dx, dy;
          int dx2;
          int v;

          dx = -d1[i - 1]
              - d3[i - 1]
              + d1[i + 1]
              + d3[i + 1];
          dx *= 2;

          dy = -d1[i - 1]
              - 2 * d1[i]
              - d1[i + 1]
              + d3[i - 1]
              + 2 * d3[i]
              + d3[i + 1];

          dx2 = -d1[i - 1]
              + 2 * d1[i]
              - d1[i + 1]
              - d3[i - 1]
              + 2 * d3[i]
              - d3[i + 1];

          if (dy < 0) {
            dy = -dy;
            dx = -dx;
          }

          if (ABS (dx) <= 4 * ABS (dx2)) {
            v = (d1[i] + d3[i] + 1) >> 1;
          } else if (dx < 0) {
            if (dx < -2 * dy) {
              v = reconstruct_h (d1 + i, d3 + i, 0, 0, 0, 16);
            } else if (dx < -dy) {
              v = reconstruct_h (d1 + i, d3 + i, 0, 0, 8, 8);
            } else if (2 * dx < -dy) {
              v = reconstruct_h (d1 + i, d3 + i, 0, 4, 8, 4);
            } else if (3 * dx < -dy) {
              v = reconstruct_h (d1 + i, d3 + i, 1, 7, 7, 1);
            } else {
              v = reconstruct_h (d1 + i, d3 + i, 4, 8, 4, 0);
            }
          } else {
            if (dx > 2 * dy) {
              v = reconstruct_h (d3 + i, d1 + i, 0, 0, 0, 16);
            } else if (dx > dy) {
              v = reconstruct_h (d3 + i, d1 + i, 0, 0, 8, 8);
            } else if (2 * dx > dy) {
              v = reconstruct_h (d3 + i, d1 + i, 0, 4, 8, 4);
            } else if (3 * dx > dy) {
              v = reconstruct_h (d3 + i, d1 + i, 1, 7, 7, 1);
            } else {
              v = reconstruct_h (d3 + i, d1 + i, 4, 8, 4, 0);
            }
          }
          d2[i] = CLAMP (v, 0, 255);
        } else {
          d2[i] = (d1[i] + d3[i] + 1) >> 1;
        }
      }
    }
    {
      guint8 *d1 = dest_data + dest_stride * 2 * j;
      guint8 *d2 = dest_data + dest_stride * (2 * j + 1);

      for (i = 0; i < src_width; i++) {
        d1[2 * i + 1] = d1[i * 2];
        d2[2 * i] = d1[i * 2];
        d2[2 * i + 1] = d1[i * 2];
      }
    }
  }
  for (k = 1; k < 3; k++) {
    src_data = inframe->data[k];
    src_stride = GST_VIDEO_FRAME_COMP_STRIDE (inframe, k);
    src_width = GST_VIDEO_FRAME_COMP_WIDTH (inframe, k);
    src_height = GST_VIDEO_FRAME_COMP_HEIGHT (inframe, k);

    dest_data = outframe->data[k];
    dest_stride = GST_VIDEO_FRAME_COMP_STRIDE (outframe, k);

    for (j = 0; j < src_height; j++) {
      guint8 *s1 = src_data + src_stride * j;
      guint8 *s2 = src_data + src_stride * (j + 1);
      guint8 *d1 = dest_data + dest_stride * 2 * j;
      guint8 *d2 = dest_data + dest_stride * (2 * j + 1);

      if (j < src_height - 1) {
        for (i = 0; i < src_width; i++) {
          d1[i * 2] = s1[i];
          d1[i * 2 + 1] = (s1[i] + s1[i + 1] + 1) >> 1;
          d2[i * 2] = (s1[i] + s2[i] + 1) >> 1;
          d2[i * 2 + 1] = (s1[i] + s1[i + 1] + s2[i] + s2[i + 1] + 2) >> 2;
        }
      } else {
        for (i = 0; i < src_width; i++) {
          d1[i * 2] = s1[i];
          d1[i * 2 + 1] = (s1[i] + s1[i + 1] + 1) >> 1;
          d2[i * 2] = s1[i];
          d2[i * 2 + 1] = (s1[i] + s1[i + 1] + 1) >> 1;
        }
      }
    }
  }

  return GST_FLOW_OK;
}

static GstFlowReturn
gst_edi_upsample_transform_frame_dirac (GstVideoFilter * filter,
    GstVideoFrame * inframe, GstVideoFrame * outframe)
{
  GstEdiUpsample *edi = GST_EDI_UPSAMPLE (filter);
  int k;
  int i, j;
  guint8 *src_data;
  int src_stride;
  int src_width;
  int src_height;
  guint8 *dest_data;
  int dest_stride;

  GST_DEBUG_OBJECT (edi, "transform_frame");

  for (k = 0; k < 1; k++) {
    src_data = inframe->data[k];
    src_stride = GST_VIDEO_FRAME_COMP_STRIDE (inframe, k);
    src_width = GST_VIDEO_FRAME_COMP_WIDTH (inframe, k);
    src_height = GST_VIDEO_FRAME_COMP_HEIGHT (inframe, k);

    dest_data = outframe->data[k];
    dest_stride = GST_VIDEO_FRAME_COMP_STRIDE (outframe, k);

#define MARGIN 3
    for (j = 0; j < src_height; j++) {
      guint8 *s = src_data + src_stride * j;
      guint8 *d = dest_data + dest_stride * 2 * j;

      for (i = 0; i < src_width; i++) {
        int v;

        v = -1 * s[CLAMP (i - 3, 0, src_width - 1)]
            + 3 * s[CLAMP (i - 2, 0, src_width - 1)]
            + -7 * s[CLAMP (i - 1, 0, src_width - 1)]
            + 21 * s[CLAMP (i, 0, src_width - 1)]
            + 21 * s[CLAMP (i + 1, 0, src_width - 1)]
            + -7 * s[CLAMP (i + 2, 0, src_width - 1)]
            + 3 * s[CLAMP (i + 3, 0, src_width - 1)]
            + -1 * s[CLAMP (i + 4, 0, src_width - 1)];
        v = (v + 16) >> 5;
        d[i * 2] = s[i];
        d[i * 2 + 1] = CLAMP (v, 0, 255);
      }
    }
    for (j = 0; j < src_height; j++) {
      guint8 *d = dest_data;

      for (i = 0; i < src_width * 2; i++) {
        int v;
        v = -1 * d[i + CLAMP (2 * j - 6, 0, 2 * src_height - 2) * dest_stride]
            + 3 * d[i + CLAMP (2 * j - 4, 0, 2 * src_height - 2) * dest_stride]
            + -7 * d[i + CLAMP (2 * j - 2, 0, 2 * src_height - 2) * dest_stride]
            + 21 * d[i + CLAMP (2 * j, 0, 2 * src_height - 2) * dest_stride]
            + 21 * d[i + CLAMP (2 * j + 2, 0, 2 * src_height - 2) * dest_stride]
            + -7 * d[i + CLAMP (2 * j + 4, 0, 2 * src_height - 2) * dest_stride]
            + 3 * d[i + CLAMP (2 * j + 6, 0, 2 * src_height - 2) * dest_stride]
            + -1 * d[i + CLAMP (2 * j + 8, 0,
                2 * src_height - 2) * dest_stride];
        v = (v + 16) >> 5;
        d[i + (2 * j + 1) * dest_stride] = CLAMP (v, 0, 255);
      }
    }
  }
  for (k = 1; k < 3; k++) {
    src_data = inframe->data[k];
    src_stride = GST_VIDEO_FRAME_COMP_STRIDE (inframe, k);
    src_width = GST_VIDEO_FRAME_COMP_WIDTH (inframe, k);
    src_height = GST_VIDEO_FRAME_COMP_HEIGHT (inframe, k);

    dest_data = outframe->data[k];
    dest_stride = GST_VIDEO_FRAME_COMP_STRIDE (outframe, k);

    for (j = 0; j < src_height; j++) {
      guint8 *s1 = src_data + src_stride * j;
      guint8 *s2 = src_data + src_stride * (j + 1);
      guint8 *d1 = dest_data + dest_stride * 2 * j;
      guint8 *d2 = dest_data + dest_stride * (2 * j + 1);

      if (j < src_height - 1) {
        for (i = 0; i < src_width; i++) {
          d1[i * 2] = s1[i];
          d1[i * 2 + 1] = (s1[i] + s1[i + 1] + 1) >> 1;
          d2[i * 2] = (s1[i] + s2[i] + 1) >> 1;
          d2[i * 2 + 1] = (s1[i] + s1[i + 1] + s2[i] + s2[i + 1] + 2) >> 2;
        }
      } else {
        for (i = 0; i < src_width; i++) {
          d1[i * 2] = s1[i];
          d1[i * 2 + 1] = (s1[i] + s1[i + 1] + 1) >> 1;
          d2[i * 2] = s1[i];
          d2[i * 2 + 1] = (s1[i] + s1[i + 1] + 1) >> 1;
        }
      }
    }
  }

  return GST_FLOW_OK;
}

static GstFlowReturn
gst_edi_upsample_transform_frame_bilinear (GstVideoFilter * filter,
    GstVideoFrame * inframe, GstVideoFrame * outframe)
{
  GstEdiUpsample *edi = GST_EDI_UPSAMPLE (filter);
  int k;
  int i, j;
  guint8 *src_data;
  int src_stride;
  int src_width;
  int src_height;
  guint8 *dest_data;
  int dest_stride;

  GST_DEBUG_OBJECT (edi, "transform_frame");

  for (k = 0; k < 1; k++) {
    src_data = inframe->data[k];
    src_stride = GST_VIDEO_FRAME_COMP_STRIDE (inframe, k);
    src_width = GST_VIDEO_FRAME_COMP_WIDTH (inframe, k);
    src_height = GST_VIDEO_FRAME_COMP_HEIGHT (inframe, k);

    dest_data = outframe->data[k];
    dest_stride = GST_VIDEO_FRAME_COMP_STRIDE (outframe, k);

    for (j = 0; j < src_height; j++) {
      guint8 *s = src_data + src_stride * j;
      guint8 *d = dest_data + dest_stride * 2 * j;

      for (i = 0; i < src_width; i++) {
        int v;

        if (i < src_width - 1) {
          v = (s[i] + s[i + 1] + 1) >> 1;
          d[i * 2] = s[i];
          d[i * 2 + 1] = CLAMP (v, 0, 255);
        } else {
          d[i * 2] = s[i];
          d[i * 2 + 1] = s[i];
        }
      }
    }
    for (j = 0; j < src_height; j++) {
      guint8 *d = dest_data + dest_stride * (2 * j + 1);

      if (j < src_height - 1) {
        for (i = 0; i < src_width * 2; i++) {
          int v;
          v = (d[i - 1 * dest_stride] + d[i + 1 * dest_stride] + 1) >> 1;
          d[i] = CLAMP (v, 0, 255);
        }
      } else {
        for (i = 0; i < src_width * 2; i++) {
          d[i] = d[i - dest_stride];
        }
      }
    }
  }
  for (k = 1; k < 3; k++) {
    src_data = inframe->data[k];
    src_stride = GST_VIDEO_FRAME_COMP_STRIDE (inframe, k);
    src_width = GST_VIDEO_FRAME_COMP_WIDTH (inframe, k);
    src_height = GST_VIDEO_FRAME_COMP_HEIGHT (inframe, k);

    dest_data = outframe->data[k];
    dest_stride = GST_VIDEO_FRAME_COMP_STRIDE (outframe, k);

    for (j = 0; j < src_height; j++) {
      guint8 *s1 = src_data + src_stride * j;
      guint8 *s2 = src_data + src_stride * (j + 1);
      guint8 *d1 = dest_data + dest_stride * 2 * j;
      guint8 *d2 = dest_data + dest_stride * (2 * j + 1);

      if (j < src_height - 1) {
        for (i = 0; i < src_width; i++) {
          d1[i * 2] = s1[i];
          d1[i * 2 + 1] = (s1[i] + s1[i + 1] + 1) >> 1;
          d2[i * 2] = (s1[i] + s2[i] + 1) >> 1;
          d2[i * 2 + 1] = (s1[i] + s1[i + 1] + s2[i] + s2[i + 1] + 2) >> 2;
        }
      } else {
        for (i = 0; i < src_width; i++) {
          d1[i * 2] = s1[i];
          d1[i * 2 + 1] = (s1[i] + s1[i + 1] + 1) >> 1;
          d2[i * 2] = s1[i];
          d2[i * 2 + 1] = (s1[i] + s1[i + 1] + 1) >> 1;
        }
      }
    }
  }

  return GST_FLOW_OK;
}

static GstFlowReturn
gst_edi_upsample_transform_frame (GstVideoFilter * filter,
    GstVideoFrame * inframe, GstVideoFrame * outframe)
{
  GstEdiUpsample *edi = GST_EDI_UPSAMPLE (filter);
  GstFlowReturn ret;

  switch (edi->method) {
    case GST_EDI_UPSAMPLE_METHOD_CGAK:
      ret = gst_edi_upsample_transform_frame_cgak (filter, inframe, outframe);
      break;
    case GST_EDI_UPSAMPLE_METHOD_BILINEAR:
      ret =
          gst_edi_upsample_transform_frame_bilinear (filter, inframe, outframe);
      break;
    case GST_EDI_UPSAMPLE_METHOD_DIRAC:
      ret = gst_edi_upsample_transform_frame_dirac (filter, inframe, outframe);
      break;
    default:
      g_assert_not_reached ();
  }
  return ret;
}
