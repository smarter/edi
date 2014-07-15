/* GStreamer
 * Copyright (C) 2013 Rdio Inc <ingestions@rd.io>
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
 * Free Software Foundation, Inc., 51 Franklin St, Fifth Floor,
 * Boston, MA 02110-1301, USA.
 */

#ifndef _GST_EDI_UPSAMPLE_H_
#define _GST_EDI_UPSAMPLE_H_

#include <gst/video/video.h>
#include <gst/video/gstvideofilter.h>

G_BEGIN_DECLS

#define GST_TYPE_EDI_UPSAMPLE   (gst_edi_upsample_get_type())
#define GST_EDI_UPSAMPLE(obj)   (G_TYPE_CHECK_INSTANCE_CAST((obj),GST_TYPE_EDI_UPSAMPLE,GstEdiUpsample))
#define GST_EDI_UPSAMPLE_CLASS(klass)   (G_TYPE_CHECK_CLASS_CAST((klass),GST_TYPE_EDI_UPSAMPLE,GstEdiUpsampleClass))
#define GST_IS_EDI_UPSAMPLE(obj)   (G_TYPE_CHECK_INSTANCE_TYPE((obj),GST_TYPE_EDI_UPSAMPLE))
#define GST_IS_EDI_UPSAMPLE_CLASS(obj)   (G_TYPE_CHECK_CLASS_TYPE((klass),GST_TYPE_EDI_UPSAMPLE))

typedef struct _GstEdiUpsample GstEdiUpsample;
typedef struct _GstEdiUpsampleClass GstEdiUpsampleClass;

typedef enum {
  GST_EDI_UPSAMPLE_METHOD_CGAK,
  GST_EDI_UPSAMPLE_METHOD_BILINEAR,
  GST_EDI_UPSAMPLE_METHOD_DIRAC
} GstEdiUpsampleMethod;

struct _GstEdiUpsample
{
  GstVideoFilter base_edi;

  GstEdiUpsampleMethod method;
};

struct _GstEdiUpsampleClass
{
  GstVideoFilterClass base_edi_class;
};

GType gst_edi_upsample_get_type (void);

G_END_DECLS

#endif
