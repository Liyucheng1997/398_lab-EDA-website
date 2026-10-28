`timescale 1ns / 1ps

// 时钟分频器：任意整数 DIV（≥ 2）分频，输出 50% 占空比。
//   偶数分频：计数到 DIV/2 翻转一次。
//   奇数分频：上升沿产生 floor(DIV/2) 个周期的高电平，再与它延迟半拍（下降沿采样）的版本相或，
//             高电平恰好延长半个周期，得到正好 50% 的占空比。
// 另外输出一个单周期的 tick 脉冲（FPGA 中更推荐用「时钟使能」代替生成新时钟）。
module clock_divider #(
  parameter DIV = 5
) (
  input  logic clk,
  input  logic rst,
  output logic clk_out,  // 分频后的时钟
  output logic tick      // 每 DIV 个周期一个高电平脉冲
);
  localparam CW = (DIV > 2) ? $clog2(DIV) : 1;

  logic [CW-1:0] cnt;
  logic          pos_q, neg_q;

  always_ff @(posedge clk) begin
    if (rst) cnt <= '0;
    else     cnt <= (cnt == CW'(DIV - 1)) ? '0 : cnt + 1'b1;
  end

  assign tick = (cnt == CW'(DIV - 1));

  // 上升沿域：每个分频周期中有 floor(DIV/2) 个时钟周期为 1
  always_ff @(posedge clk) begin
    if (rst) pos_q <= 1'b0;
    else     pos_q <= (cnt < CW'(DIV / 2));
  end

  // 下降沿域：把 pos_q 延迟半个周期，用于奇数分频
  always_ff @(negedge clk) begin
    if (rst) neg_q <= 1'b0;
    else     neg_q <= pos_q;
  end

  generate
    if (DIV % 2 == 0) begin : g_even
      assign clk_out = pos_q;
    end else begin : g_odd
      assign clk_out = pos_q | neg_q;
    end
  endgenerate
endmodule
