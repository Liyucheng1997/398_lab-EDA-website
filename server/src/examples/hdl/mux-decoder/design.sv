`timescale 1ns / 1ps

// 三种常见组合电路：多路选择器、译码器、优先编码器

// 4 选 1 多路选择器（位宽可参数化）
module mux4 #(
  parameter W = 8
) (
  input  logic [W-1:0] d0, d1, d2, d3,
  input  logic [1:0]   sel,
  output logic [W-1:0] y
);
  always_comb begin
    case (sel)
      2'd0:    y = d0;
      2'd1:    y = d1;
      2'd2:    y = d2;
      default: y = d3;
    endcase
  end
endmodule

// 3-8 译码器（带使能，输出独热码）
module decoder3to8 (
  input  logic [2:0] a,
  input  logic       en,
  output logic [7:0] y
);
  assign y = en ? (8'b1 << a) : 8'b0;
endmodule

// 8 输入优先编码器：编号最大的有效请求优先
module priority_encoder8 (
  input  logic [7:0] req,
  output logic [2:0] idx,    // 最高优先级请求的编号
  output logic       valid   // 至少有一个请求
);
  always @* begin
    idx = 3'd0;
    for (integer i = 0; i < 8; i = i + 1)
      if (req[i]) idx = i[2:0];  // 后面的（编号更大）覆盖前面的
  end
  assign valid = |req;
endmodule

// 顶层：把三个模块组合在一起，方便在原理图中一并查看
module mux_decoder_top (
  input  logic [7:0] req,
  input  logic [1:0] sel,
  output logic [7:0] onehot,
  output logic [7:0] y,
  output logic       valid
);
  logic [2:0] idx;

  priority_encoder8 enc (.req(req), .idx(idx), .valid(valid));
  decoder3to8       dec (.a(idx), .en(valid), .y(onehot));
  mux4 #(.W(8))     mux (.d0(req), .d1(onehot), .d2(~req), .d3({5'd0, idx}), .sel(sel), .y(y));
endmodule
