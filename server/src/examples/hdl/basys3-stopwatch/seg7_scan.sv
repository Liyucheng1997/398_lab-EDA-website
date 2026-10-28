`timescale 1ns / 1ps

// 4 位共阳数码管动态扫描（Basys 3：段选、位选均低电平有效）。
//   每 SCAN_DIV 个时钟切换到下一位，4 位轮流点亮；刷新足够快时人眼看到的是 4 位同时亮。
//   value[3:0] 显示在最右边一位（AN0），value[15:12] 显示在最左边一位（AN3）。
module seg7_scan #(
  parameter SCAN_DIV = 100_000      // 每一位点亮的时钟数（≥ 1）
) (
  input  logic        clk,
  input  logic [15:0] value,        // 4 个十六进制数字
  input  logic [3:0]  dp,           // 各位的小数点，1 = 点亮
  input  logic [3:0]  blank,        // 各位消隐，1 = 熄灭
  output logic [7:0]  seg_n,        // {dp, g, f, e, d, c, b, a}，低电平点亮
  output logic [3:0]  an_n          // 位选，低电平有效
);
  localparam CW = (SCAN_DIV > 1) ? $clog2(SCAN_DIV) : 1;

  logic [CW-1:0] cnt = '0;
  logic [1:0]    idx = '0;

  always_ff @(posedge clk) begin
    if (cnt >= CW'(SCAN_DIV - 1)) begin
      cnt <= '0;
      idx <= idx + 2'd1;
    end else begin
      cnt <= cnt + 1'b1;
    end
  end

  // 十六进制 → 七段（{g,f,e,d,c,b,a}，高电平点亮）
  function automatic logic [6:0] hex7(input logic [3:0] h);
    case (h)
      4'h0: hex7 = 7'b0111111;  4'h1: hex7 = 7'b0000110;
      4'h2: hex7 = 7'b1011011;  4'h3: hex7 = 7'b1001111;
      4'h4: hex7 = 7'b1100110;  4'h5: hex7 = 7'b1101101;
      4'h6: hex7 = 7'b1111101;  4'h7: hex7 = 7'b0000111;
      4'h8: hex7 = 7'b1111111;  4'h9: hex7 = 7'b1101111;
      4'hA: hex7 = 7'b1110111;  4'hB: hex7 = 7'b1111100;
      4'hC: hex7 = 7'b0111001;  4'hD: hex7 = 7'b1011110;
      4'hE: hex7 = 7'b1111001;  default: hex7 = 7'b1110001;
    endcase
  endfunction

  logic [3:0] nibble;
  logic       cur_dp, cur_blank;

  assign nibble    = value[idx*4 +: 4];
  assign cur_dp    = dp[idx];
  assign cur_blank = blank[idx];

  // 输出寄存一拍，避免切换位选时出现毛刺
  always_ff @(posedge clk) begin
    an_n  <= ~(4'b0001 << idx);
    seg_n <= cur_blank ? 8'hFF : ~{cur_dp, hex7(nibble)};
  end
endmodule
